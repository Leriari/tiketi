"""
Tickets stay on the TiketiNFT they were minted on (app/services/web3_service.py).
Only the first contract (NFT_LEGACY_CONTRACT_ADDRESS) has the old ABI with
no resale floor; every later one shares the current ABI.
"""
from types import SimpleNamespace

import pytest

from app.services import web3_service

V1 = "0x302ad7F719A790E6B9Fb2F875C1Ec3Cda9732f4a"
V2 = "0x8Bf2FeBA3Cc82EBf36cC27497f2d7B193cE0db65"


@pytest.fixture
def legacy(monkeypatch):
    monkeypatch.setattr(web3_service.settings, "NFT_LEGACY_CONTRACT_ADDRESS", V1)


def test_only_the_first_contract_lacks_the_floor(legacy):
    assert not web3_service.has_onchain_floor(V1)
    assert not web3_service.has_onchain_floor(V1.lower())
    assert web3_service.has_onchain_floor(V2)  # an earlier contract, but not v1
    assert web3_service.has_onchain_floor(None)  # the current one


def test_each_contract_is_read_at_its_own_address_and_abi(legacy):
    v1 = web3_service._get_contract(V1)
    v2 = web3_service._get_contract(V2)
    assert v1.address == V1 and v2.address == V2
    assert "resaleFloorBps" not in str(v1.abi)
    assert "resaleFloorBps" in str(v2.abi)


def test_a_ticket_from_before_the_column_is_on_v1(legacy):
    assert web3_service.ticket_contract_address(SimpleNamespace(nft_contract_address=None)) == V1
    assert web3_service.ticket_contract_address(SimpleNamespace(nft_contract_address=V2)) == V2
