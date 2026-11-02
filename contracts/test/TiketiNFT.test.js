const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const FACE_PRICE_KES = 1000n;
const DEFAULT_FLOOR_BPS = 8000; // 80% of face value
const DEFAULT_CAP_BPS = 11000; // 110% of face value
const DEFAULT_ROYALTY_BPS = 1000; // 10%

async function deployFixture() {
  const [owner, minterWallet, buyer, other, thirdParty] = await ethers.getSigners();

  const TiketiNFT = await ethers.getContractFactory("TiketiNFT");
  const nft = await TiketiNFT.connect(owner).deploy(minterWallet.address);
  await nft.waitForDeployment();

  return { nft, owner, minterWallet, buyer, other, thirdParty };
}

async function mintOne(nft, minterWallet, to, overrides = {}) {
  const {
    eventId = 1,
    tierId = 1,
    facePriceKes = FACE_PRICE_KES,
    resaleFloorBps = DEFAULT_FLOOR_BPS,
    resaleCapBps = DEFAULT_CAP_BPS,
    royaltyBps = DEFAULT_ROYALTY_BPS,
  } = overrides;

  const tx = await nft
    .connect(minterWallet)
    .mintTicket(to.address, eventId, tierId, facePriceKes, resaleFloorBps, resaleCapBps, royaltyBps);
  const receipt = await tx.wait();
  const mintedEvent = receipt.logs
    .map((log) => {
      try {
        return nft.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === "TicketMinted");
  return mintedEvent.args.tokenId;
}

describe("TiketiNFT", function () {
  describe("Minting", function () {
    it("mints starting at token ID 1, never 0 (0 is the backend's sentinel)", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      expect(tokenId).to.equal(1n);
      expect(await nft.ownerOf(1)).to.equal(buyer.address);
    });

    it("stores ticket metadata correctly", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, {
        eventId: 42,
        tierId: 3,
        facePriceKes: 2500n,
        resaleFloorBps: 9000,
        resaleCapBps: 12000,
        royaltyBps: 800,
      });
      const meta = await nft.ticketMeta(tokenId);
      expect(meta.eventId).to.equal(42n);
      expect(meta.tierId).to.equal(3n);
      expect(meta.facePriceKes).to.equal(2500n);
      expect(meta.resaleFloorBps).to.equal(9000);
      expect(meta.resaleCapBps).to.equal(12000);
      expect(meta.used).to.equal(false);
      expect(meta.claimed).to.equal(false);
    });

    it("sets the ERC-2981 royalty receiver to the minter", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, { royaltyBps: 1000 });
      const [receiver, amount] = await nft.royaltyInfo(tokenId, 10_000n);
      expect(receiver).to.equal(minterWallet.address);
      expect(amount).to.equal(1000n); // 10% of 10,000
    });

    it("emits TicketMinted", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      await expect(
        nft.connect(minterWallet).mintTicket(buyer.address, 1, 1, FACE_PRICE_KES, DEFAULT_FLOOR_BPS, DEFAULT_CAP_BPS, DEFAULT_ROYALTY_BPS)
      )
        .to.emit(nft, "TicketMinted")
        .withArgs(1n, buyer.address, 1n, 1n, FACE_PRICE_KES, DEFAULT_FLOOR_BPS, DEFAULT_CAP_BPS, DEFAULT_ROYALTY_BPS);
    });
  });

  // ── Anti-scalping enforcement ────────────────────────────────────────────
  // This is the headline claim in the report's evaluation chapter: resale
  // listings above the organiser's cap are not merely discouraged, they are
  // impossible on-chain. Tested across multiple cap values, at the exact
  // boundary in both directions, not a single happy-path assertion.
  describe("Anti-scalping enforcement", function () {
    const capValues = [10500, 11000, 15000]; // 105%, 110%, 150%

    for (const capBps of capValues) {
      describe(`with a ${capBps / 100}% cap`, function () {
        it("allows a listing at exactly the cap", async function () {
          const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
          const tokenId = await mintOne(nft, minterWallet, buyer, { resaleCapBps: capBps });
          const capPrice = (FACE_PRICE_KES * BigInt(capBps)) / 10000n;

          await expect(nft.connect(buyer).listForResale(tokenId, capPrice))
            .to.emit(nft, "ListedForResale")
            .withArgs(tokenId, buyer.address, capPrice);
          expect(await nft.listingPriceKes(tokenId)).to.equal(capPrice);
        });

        it("reverts a listing one shilling above the cap", async function () {
          const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
          const tokenId = await mintOne(nft, minterWallet, buyer, { resaleCapBps: capBps });
          const capPrice = (FACE_PRICE_KES * BigInt(capBps)) / 10000n;

          await expect(
            nft.connect(buyer).listForResale(tokenId, capPrice + 1n)
          ).to.be.revertedWith("TiketiNFT: price exceeds resale cap");
          expect(await nft.listingPriceKes(tokenId)).to.equal(0n);
        });
      });
    }

    it("reverts a listing far above the cap", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, { resaleCapBps: 11000 });
      await expect(
        nft.connect(buyer).listForResale(tokenId, FACE_PRICE_KES * 100n)
      ).to.be.revertedWith("TiketiNFT: price exceeds resale cap");
    });

    // The floor stops a ticket being dumped below what the organiser allows
    // (e.g. to move it off-platform for cash): enforced the same way as the cap.
    const floorValues = [5000, 8000, 10000]; // 50%, 80%, 100%
    for (const floorBps of floorValues) {
      describe(`with a ${floorBps / 100}% floor`, function () {
        it("allows a listing at exactly the floor", async function () {
          const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
          const tokenId = await mintOne(nft, minterWallet, buyer, { resaleFloorBps: floorBps });
          const floorPrice = (FACE_PRICE_KES * BigInt(floorBps)) / 10000n;
          await expect(nft.connect(buyer).listForResale(tokenId, floorPrice)).to.emit(nft, "ListedForResale");
        });

        it("reverts a listing one shilling below the floor", async function () {
          const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
          const tokenId = await mintOne(nft, minterWallet, buyer, { resaleFloorBps: floorBps });
          const floorPrice = (FACE_PRICE_KES * BigInt(floorBps)) / 10000n;
          await expect(
            nft.connect(buyer).listForResale(tokenId, floorPrice - 1n)
          ).to.be.revertedWith("TiketiNFT: price below resale floor");
          expect(await nft.listingPriceKes(tokenId)).to.equal(0n);
        });
      });
    }

    it("rounds a fractional floor up, so it is never undercut", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      // 33.33% of KES 1,000 is KES 333.3: KES 333 is below it, KES 334 is not.
      const tokenId = await mintOne(nft, minterWallet, buyer, { resaleFloorBps: 3333 });
      await expect(nft.connect(buyer).listForResale(tokenId, 333n)).to.be.revertedWith("TiketiNFT: price below resale floor");
      await expect(nft.connect(buyer).listForResale(tokenId, 334n)).to.emit(nft, "ListedForResale");
    });

    it("a zero floor allows any positive price", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, { resaleFloorBps: 0 });
      await expect(nft.connect(buyer).listForResale(tokenId, 1n)).to.emit(nft, "ListedForResale");
    });

    it("cannot mint a ticket whose floor is above its cap", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      await expect(
        nft.connect(minterWallet).mintTicket(buyer.address, 1, 1, FACE_PRICE_KES, 12000, 11000, DEFAULT_ROYALTY_BPS)
      ).to.be.revertedWith("TiketiNFT: floor above cap");
    });

    it("only the token owner can list it", async function () {
      const { nft, minterWallet, buyer, other } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(
        nft.connect(other).listForResale(tokenId, FACE_PRICE_KES)
      ).to.be.revertedWith("TiketiNFT: caller is not token owner");
    });

    it("cannot list an already-used ticket", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(minterWallet).markUsed(tokenId);
      await expect(
        nft.connect(buyer).listForResale(tokenId, FACE_PRICE_KES)
      ).to.be.revertedWith("TiketiNFT: ticket already used");
    });
  });

  // ── Royalty split correctness ────────────────────────────────────────────
  describe("buyResale — royalty split correctness", function () {
    it("splits proceeds exactly between seller and royalty receiver, no wei unaccounted", async function () {
      const { nft, minterWallet, buyer, other: purchaser } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, { royaltyBps: 1000 }); // 10%
      const listPriceKes = FACE_PRICE_KES; // within cap
      await nft.connect(buyer).listForResale(tokenId, listPriceKes);

      const salePriceWei = ethers.parseEther("1.0");
      const expectedRoyalty = (salePriceWei * 1000n) / 10000n; // 10%
      const expectedSeller = salePriceWei - expectedRoyalty;

      const tx = nft.connect(purchaser).buyResale(tokenId, { value: salePriceWei });

      await expect(tx).to.changeEtherBalances(
        [buyer, minterWallet],
        [expectedSeller, expectedRoyalty]
      );

      // No wei unaccounted for.
      expect(expectedSeller + expectedRoyalty).to.equal(salePriceWei);

      await expect(tx)
        .to.emit(nft, "ResaleCompleted")
        .withArgs(tokenId, buyer.address, purchaser.address, salePriceWei, expectedRoyalty);

      expect(await nft.ownerOf(tokenId)).to.equal(purchaser.address);
      expect(await nft.listingPriceKes(tokenId)).to.equal(0n);
    });

    it("handles a 0% royalty cleanly — seller gets the full sale price", async function () {
      const { nft, minterWallet, buyer, other: purchaser } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer, { royaltyBps: 0 });
      await nft.connect(buyer).listForResale(tokenId, FACE_PRICE_KES);

      const salePriceWei = ethers.parseEther("0.5");
      const tx = nft.connect(purchaser).buyResale(tokenId, { value: salePriceWei });

      await expect(tx).to.changeEtherBalances([buyer, minterWallet], [salePriceWei, 0n]);
    });

    it("reverts if the token is not listed", async function () {
      const { nft, minterWallet, buyer, other: purchaser } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(
        nft.connect(purchaser).buyResale(tokenId, { value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("TiketiNFT: not listed for resale");
    });

    it("reverts if the buyer sends no payment", async function () {
      const { nft, minterWallet, buyer, other: purchaser } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(buyer).listForResale(tokenId, FACE_PRICE_KES);
      await expect(
        nft.connect(purchaser).buyResale(tokenId, { value: 0 })
      ).to.be.revertedWith("TiketiNFT: payment required");
    });

    it("reverts if the seller tries to buy their own listing", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(buyer).listForResale(tokenId, FACE_PRICE_KES);
      await expect(
        nft.connect(buyer).buyResale(tokenId, { value: ethers.parseEther("1.0") })
      ).to.be.revertedWith("TiketiNFT: cannot buy your own listing");
    });

    it("does not leave the token transferred if the token was never listed (rejected before any transfer)", async function () {
      // buyResale's very first state-changing effect is contingent on a
      // successful listing check, so a reverted purchase attempt must leave
      // ownership untouched — this is the "atomicity" the spec calls for.
      const { nft, minterWallet, buyer, other: purchaser } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(
        nft.connect(purchaser).buyResale(tokenId, { value: ethers.parseEther("1.0") })
      ).to.be.reverted;
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    });
  });

  // ── Custodial resale settlement (fiat/M-Pesa path) ───────────────────────
  describe("settleCustodialResale — custodial (fiat) resale settlement", function () {
    it("clears the listing and emits CustodialResaleSettled", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      // Custodial tickets are minted to the minter itself — the backend is
      // both the token owner and the caller of listForResale/settleCustodialResale.
      const tokenId = await mintOne(nft, minterWallet, minterWallet);
      await nft.connect(minterWallet).listForResale(tokenId, FACE_PRICE_KES);

      await expect(nft.connect(minterWallet).settleCustodialResale(tokenId))
        .to.emit(nft, "CustodialResaleSettled")
        .withArgs(tokenId, FACE_PRICE_KES);

      expect(await nft.listingPriceKes(tokenId)).to.equal(0n);
      // Custodial ownership never moves on-chain — see the function's own
      // NatSpec for why. It stays with the minter throughout.
      expect(await nft.ownerOf(tokenId)).to.equal(minterWallet.address);
    });

    it("reverts if the token was never listed", async function () {
      const { nft, minterWallet } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, minterWallet);
      await expect(
        nft.connect(minterWallet).settleCustodialResale(tokenId)
      ).to.be.revertedWith("TiketiNFT: not listed for resale");
    });

    it("reverts for a non-minter", async function () {
      const { nft, minterWallet, other } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, minterWallet);
      await nft.connect(minterWallet).listForResale(tokenId, FACE_PRICE_KES);
      await expect(
        nft.connect(other).settleCustodialResale(tokenId)
      ).to.be.revertedWith("TiketiNFT: caller is not the minter");
    });

    it("cannot be settled twice", async function () {
      const { nft, minterWallet } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, minterWallet);
      await nft.connect(minterWallet).listForResale(tokenId, FACE_PRICE_KES);
      await nft.connect(minterWallet).settleCustodialResale(tokenId);
      await expect(
        nft.connect(minterWallet).settleCustodialResale(tokenId)
      ).to.be.revertedWith("TiketiNFT: not listed for resale");
    });
  });

  // ── Double-spend prevention ──────────────────────────────────────────────
  describe("markUsed — double-spend prevention", function () {
    it("marks a ticket used and emits TicketUsed", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(nft.connect(minterWallet).markUsed(tokenId))
        .to.emit(nft, "TicketUsed")
        .withArgs(tokenId, buyer.address);
      expect((await nft.ticketMeta(tokenId)).used).to.equal(true);
    });

    it("reverts on a second markUsed call for the same token", async function () {
      const { nft, minterWallet, buyer } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(minterWallet).markUsed(tokenId);
      await expect(
        nft.connect(minterWallet).markUsed(tokenId)
      ).to.be.revertedWith("TiketiNFT: ticket already used");
    });
  });

  // ── Access control ────────────────────────────────────────────────────────
  describe("Access control", function () {
    it("mintTicket reverts for a non-minter", async function () {
      const { nft, buyer, other } = await loadFixture(deployFixture);
      await expect(
        nft.connect(other).mintTicket(buyer.address, 1, 1, FACE_PRICE_KES, DEFAULT_FLOOR_BPS, DEFAULT_CAP_BPS, DEFAULT_ROYALTY_BPS)
      ).to.be.revertedWith("TiketiNFT: caller is not the minter");
    });

    it("markUsed reverts for a non-minter", async function () {
      const { nft, minterWallet, buyer, other } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(
        nft.connect(other).markUsed(tokenId)
      ).to.be.revertedWith("TiketiNFT: caller is not the minter");
    });

    it("setMinter reverts for a non-owner", async function () {
      const { nft, other, thirdParty } = await loadFixture(deployFixture);
      await expect(
        nft.connect(other).setMinter(thirdParty.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("setMinter succeeds for the owner and the new minter can mint", async function () {
      const { nft, owner, buyer, thirdParty } = await loadFixture(deployFixture);
      await nft.connect(owner).setMinter(thirdParty.address);
      expect(await nft.minter()).to.equal(thirdParty.address);

      await expect(
        nft.connect(thirdParty).mintTicket(buyer.address, 1, 1, FACE_PRICE_KES, DEFAULT_FLOOR_BPS, DEFAULT_CAP_BPS, DEFAULT_ROYALTY_BPS)
      ).to.not.be.reverted;
    });
  });

  // ── Custody transfer ─────────────────────────────────────────────────────
  describe("claimTicket — custody transfer", function () {
    it("moves the token to the external address and emits TicketClaimed", async function () {
      const { nft, minterWallet, buyer, other: externalWallet } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);

      await expect(nft.connect(buyer).claimTicket(tokenId, externalWallet.address))
        .to.emit(nft, "TicketClaimed")
        .withArgs(tokenId, buyer.address, externalWallet.address);

      expect(await nft.ownerOf(tokenId)).to.equal(externalWallet.address);
      expect((await nft.ticketMeta(tokenId)).claimed).to.equal(true);
    });

    it("the original custodian can no longer transfer the token after claiming", async function () {
      const { nft, minterWallet, buyer, other: externalWallet, thirdParty } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(buyer).claimTicket(tokenId, externalWallet.address);

      await expect(
        nft.connect(buyer).transferFrom(buyer.address, thirdParty.address, tokenId)
      ).to.be.revertedWith("ERC721: caller is not token owner or approved");

      await expect(
        nft.connect(buyer).claimTicket(tokenId, thirdParty.address)
      ).to.be.revertedWith("TiketiNFT: caller is not token owner");
    });

    it("cannot claim the same token twice, even by the new owner", async function () {
      const { nft, minterWallet, buyer, other: externalWallet, thirdParty } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await nft.connect(buyer).claimTicket(tokenId, externalWallet.address);

      await expect(
        nft.connect(externalWallet).claimTicket(tokenId, thirdParty.address)
      ).to.be.revertedWith("TiketiNFT: already claimed");
    });

    it("reverts for a non-owner trying to claim someone else's ticket", async function () {
      const { nft, minterWallet, buyer, other } = await loadFixture(deployFixture);
      const tokenId = await mintOne(nft, minterWallet, buyer);
      await expect(
        nft.connect(other).claimTicket(tokenId, other.address)
      ).to.be.revertedWith("TiketiNFT: caller is not token owner");
    });
  });
});
