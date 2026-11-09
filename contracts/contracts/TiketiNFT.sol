// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title TiketiNFT — ChainTix event ticket, ERC-721 + ERC-2981 royalties
/// @notice Each token is one ticket. Anti-scalping is enforced on-chain:
///         a resale listing above its cap, or below its floor (both set
///         from face value at mint, by the organiser), cannot be created,
///         and a ticket can't be handed over any other way: plain ERC-721
///         transfers are blocked, so it moves only through buyResale or a
///         one-time claimTicket.
contract TiketiNFT is ERC721, ERC2981, Ownable, ReentrancyGuard {
    struct TicketMeta {
        uint256 eventId;
        uint256 tierId;
        uint256 facePriceKes;
        uint16 resaleFloorBps; // basis points of facePriceKes, e.g. 8000 = 80%; 0 = no floor
        uint16 resaleCapBps; // basis points of facePriceKes, e.g. 11000 = 110% (a 10% uplift ceiling)
        bool used;
        bool claimed;
    }

    /// @dev Token ID 0 is never minted — it's the backend's "no NFT yet" sentinel
    /// (Ticket.nft_token_id is a nullable integer column and needs a value that
    /// can never collide with a real token).
    uint256 private _nextTokenId = 1;

    /// @notice The backend relayer wallet allowed to mint and mark tickets used.
    /// Royalties on every mint are also routed to this address — it is the
    /// platform's custodial wallet, which forwards an organiser's share off-chain,
    /// matching this project's Web 2.5 custodial-wallet design everywhere else.
    address public minter;

    mapping(uint256 => TicketMeta) public ticketMeta;

    /// @notice KES-denominated resale ask for a listed token. 0 = not listed.
    /// This is the figure the on-chain cap check runs against; the actual
    /// settlement in buyResale is in the chain's native currency (msg.value),
    /// since KES itself is not an on-chain asset.
    mapping(uint256 => uint256) public listingPriceKes;

    /// @dev Set only while buyResale or claimTicket moves a token: the two
    /// moves this contract allows (see _beforeTokenTransfer).
    bool private _allowedMove;

    event TicketMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint256 indexed eventId,
        uint256 tierId,
        uint256 facePriceKes,
        uint16 resaleFloorBps,
        uint16 resaleCapBps,
        uint96 royaltyBps
    );
    event ListedForResale(uint256 indexed tokenId, address indexed seller, uint256 priceKes);
    event ResaleCompleted(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 salePriceWei,
        uint256 royaltyPaidWei
    );
    /// @notice A resale settled through the custodial/fiat path (M-Pesa), not
    /// through buyResale's on-chain ETH payment. See settleCustodialResale.
    event CustodialResaleSettled(uint256 indexed tokenId, uint256 salePriceKes);
    event TicketUsed(uint256 indexed tokenId, address indexed holder);
    event TicketClaimed(uint256 indexed tokenId, address indexed from, address indexed to);

    modifier onlyMinter() {
        require(msg.sender == minter, "TiketiNFT: caller is not the minter");
        _;
    }

    constructor(address _minter) ERC721("ChainTix", "CTIX") {
        require(_minter != address(0), "TiketiNFT: minter cannot be zero address");
        minter = _minter;
    }

    /// @notice Mint a new ticket. Minter-only. The resale floor and cap are
    /// fixed here for the token's lifetime: nobody can change them later.
    function mintTicket(
        address to,
        uint256 eventId,
        uint256 tierId,
        uint256 facePriceKes,
        uint16 resaleFloorBps,
        uint16 resaleCapBps,
        uint96 royaltyBps
    ) external onlyMinter returns (uint256) {
        require(to != address(0), "TiketiNFT: cannot mint to zero address");
        require(resaleFloorBps <= resaleCapBps, "TiketiNFT: floor above cap");

        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        ticketMeta[tokenId] = TicketMeta({
            eventId: eventId,
            tierId: tierId,
            facePriceKes: facePriceKes,
            resaleFloorBps: resaleFloorBps,
            resaleCapBps: resaleCapBps,
            used: false,
            claimed: false
        });

        // Royalty receiver is the minter (the platform relayer) — see the
        // `minter` doc comment above for why there's no separate receiver param.
        _setTokenRoyalty(tokenId, minter, royaltyBps);

        emit TicketMinted(tokenId, to, eventId, tierId, facePriceKes, resaleFloorBps, resaleCapBps, royaltyBps);
        return tokenId;
    }

    /// @notice List an owned, unused ticket for resale. Reverts above the cap
    /// or below the floor — this revert IS the anti-scalping enforcement.
    function listForResale(uint256 tokenId, uint256 priceKes) external {
        require(_exists(tokenId), "TiketiNFT: token does not exist");
        require(ownerOf(tokenId) == msg.sender, "TiketiNFT: caller is not token owner");
        require(!ticketMeta[tokenId].used, "TiketiNFT: ticket already used");
        require(priceKes > 0, "TiketiNFT: price must be positive");

        TicketMeta storage meta = ticketMeta[tokenId];
        uint256 cap = (meta.facePriceKes * meta.resaleCapBps) / 10000;
        require(priceKes <= cap, "TiketiNFT: price exceeds resale cap");
        // Rounded up, so a floor is never undercut by integer division.
        uint256 floor = (meta.facePriceKes * meta.resaleFloorBps + 9999) / 10000;
        require(priceKes >= floor, "TiketiNFT: price below resale floor");

        listingPriceKes[tokenId] = priceKes;
        emit ListedForResale(tokenId, msg.sender, priceKes);
    }

    /// @notice Buy a listed ticket. The sale price is msg.value (native
    /// currency); proceeds are split between the seller and the ERC-2981
    /// royalty receiver. Reverts (undoing the transfer too) if either leg
    /// of the payment fails, so the token is never left transferred without
    /// the seller having actually been paid.
    function buyResale(uint256 tokenId) external payable nonReentrant {
        require(_exists(tokenId), "TiketiNFT: token does not exist");
        uint256 priceKes = listingPriceKes[tokenId];
        require(priceKes > 0, "TiketiNFT: not listed for resale");
        require(msg.value > 0, "TiketiNFT: payment required");

        address seller = ownerOf(tokenId);
        require(seller != msg.sender, "TiketiNFT: cannot buy your own listing");

        (address royaltyReceiver, uint256 royaltyAmount) = royaltyInfo(tokenId, msg.value);
        uint256 sellerProceeds = msg.value - royaltyAmount;

        // Effects before interactions: clear the listing and move ownership
        // first, so a reentrant call sees this token as already sold.
        listingPriceKes[tokenId] = 0;
        _move(seller, msg.sender, tokenId);

        (bool sellerPaid, ) = payable(seller).call{value: sellerProceeds}("");
        require(sellerPaid, "TiketiNFT: seller payment failed");

        if (royaltyAmount > 0 && royaltyReceiver != address(0)) {
            (bool royaltyPaid, ) = payable(royaltyReceiver).call{value: royaltyAmount}("");
            require(royaltyPaid, "TiketiNFT: royalty payment failed");
        }

        emit ResaleCompleted(tokenId, seller, msg.sender, msg.value, royaltyAmount);
    }

    /// @notice Settle a resale that was paid for off-chain in KES (M-Pesa), not
    /// through buyResale's ETH payment. Minter-only — the backend calls this
    /// only after confirming the M-Pesa payment succeeded.
    ///
    /// Every custodially-held ticket's on-chain owner is the minter both
    /// before and after this call (buyer identity is tracked off-chain in the
    /// backend's database — see web3_service.py's module docstring for why),
    /// so unlike buyResale there is no ERC-721 ownership change to make here.
    /// What this function provides is the thing the fiat path otherwise
    /// lacks entirely: a real on-chain transaction — a permanent, public
    /// record that this specific listing was consumed and settled, at this
    /// block, for this KES price — rather than the sale existing only as a
    /// row in the backend's database.
    function settleCustodialResale(uint256 tokenId) external onlyMinter {
        require(_exists(tokenId), "TiketiNFT: token does not exist");
        uint256 priceKes = listingPriceKes[tokenId];
        require(priceKes > 0, "TiketiNFT: not listed for resale");

        listingPriceKes[tokenId] = 0;
        emit CustodialResaleSettled(tokenId, priceKes);
    }

    /// @notice Mark a ticket used at the gate. Minter-only, one-time.
    function markUsed(uint256 tokenId) external onlyMinter {
        require(_exists(tokenId), "TiketiNFT: token does not exist");
        require(!ticketMeta[tokenId].used, "TiketiNFT: ticket already used");

        ticketMeta[tokenId].used = true;
        emit TicketUsed(tokenId, ownerOf(tokenId));
    }

    /// @notice Move a custodially-held ticket to the holder's own wallet.
    /// One-time per token. After that the owner can only resell it through
    /// listForResale/buyResale, within its cap and floor. A listing doesn't
    /// survive the move.
    function claimTicket(uint256 tokenId, address to) external {
        require(_exists(tokenId), "TiketiNFT: token does not exist");
        require(ownerOf(tokenId) == msg.sender, "TiketiNFT: caller is not token owner");
        require(to != address(0), "TiketiNFT: cannot claim to zero address");
        require(!ticketMeta[tokenId].claimed, "TiketiNFT: already claimed");

        ticketMeta[tokenId].claimed = true;
        listingPriceKes[tokenId] = 0;
        _move(msg.sender, to, tokenId);

        emit TicketClaimed(tokenId, msg.sender, to);
    }

    /// @notice Change the minter address. Owner-only.
    function setMinter(address newMinter) external onlyOwner {
        require(newMinter != address(0), "TiketiNFT: minter cannot be zero address");
        minter = newMinter;
    }

    function _move(address from, address to, uint256 tokenId) private {
        _allowedMove = true;
        _transfer(from, to, tokenId);
        _allowedMove = false;
    }

    /// @dev Minting is allowed; any other move must come from _move. This
    /// blocks transferFrom and safeTransferFrom, which would otherwise let a
    /// holder sell a ticket at any price outside the contract.
    function _beforeTokenTransfer(address from, address to, uint256 firstTokenId, uint256 batchSize)
        internal
        override
    {
        require(from == address(0) || _allowedMove, "TiketiNFT: tickets move only by resale or claim");
        super._beforeTokenTransfer(from, to, firstTokenId, batchSize);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
