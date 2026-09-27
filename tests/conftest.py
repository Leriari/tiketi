"""
Test-session bootstrap for real (not mocked) blockchain integration tests.

Work Order 02's resale tests need genuine on-chain reverts as evidence —
"assert that the failure originated from a contract revert, not from
application validation" only means something if a real EVM produced that
revert. So this spins up an ephemeral local Hardhat node before any test
module is imported, deploys TiketiNFT to it fresh, and points
BLOCKCHAIN_RPC_URL / NFT_CONTRACT_ADDRESS / MINTER_PRIVATE_KEY at it via
os.environ — which pydantic-settings reads in preference to whatever's
already in the real .env file (the actual Base Sepolia deployment), so the
test suite never touches real testnet funds or state.

This has to happen in pytest_configure, not a fixture: pytest imports every
test module during collection, before any fixture runs, and
app.core.config.get_settings() is @lru_cache'd — the first import of
app.main anywhere (during that collection) would otherwise permanently
cache the real .env's values for the rest of the process.

Windows note: killing the Hardhat node cleanly needs care. The Popen handle
for `npx hardhat node` is a cmd.exe/npx wrapper, not the underlying node.exe
— terminating just that handle leaves node.exe orphaned and still holding
port 8545 (this exact failure mode has bitten manual testing earlier in
this project). Teardown instead finds the actual PID bound to port 8545
via `netstat` and kills that directly.
"""
import os
import re
import socket
import subprocess
import time
from pathlib import Path

CONTRACTS_DIR = Path(__file__).resolve().parent.parent / "contracts"

# Hardhat's universally-published local dev key for account #0 — public,
# documented in Hardhat's own output, safe for local-only testing, never
# used for (and incapable of holding) real funds.
LOCAL_MINTER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

_node_process = None
_node_pid_on_port = None


def _port_listening(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=1):
            return True
    except OSError:
        return False


def _wait_for_port(host: str, port: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _port_listening(host, port):
            return True
        time.sleep(0.5)
    return False


def _find_pid_on_port(port: int) -> int | None:
    result = subprocess.run(
        ["netstat", "-ano"], capture_output=True, text=True, timeout=10
    )
    for line in result.stdout.splitlines():
        if f":{port}" in line and "LISTENING" in line:
            return int(line.split()[-1])
    return None


def pytest_configure(config):
    global _node_process, _node_pid_on_port

    if _port_listening("127.0.0.1", 8545):
        raise RuntimeError(
            "Something is already listening on 127.0.0.1:8545 — refusing to "
            "start the test Hardhat node on top of it. Free the port first."
        )

    _node_process = subprocess.Popen(
        "npx hardhat node",
        cwd=str(CONTRACTS_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        shell=True,
    )

    if not _wait_for_port("127.0.0.1", 8545, timeout=30):
        raise RuntimeError("Local Hardhat node did not start in time for resale tests")

    _node_pid_on_port = _find_pid_on_port(8545)

    # contracts/.env has a real MINTER_ADDRESS set for the actual Base
    # Sepolia deployment — dotenv won't override an already-present env var,
    # so explicitly blanking it here (falsy in JS) makes deploy.js fall back
    # to the deployer's own address, matching LOCAL_MINTER_PRIVATE_KEY above.
    deploy_env = {**os.environ, "MINTER_ADDRESS": ""}
    deploy = subprocess.run(
        "npx hardhat run scripts/deploy.js --network localhost",
        cwd=str(CONTRACTS_DIR),
        capture_output=True,
        text=True,
        shell=True,
        timeout=60,
        env=deploy_env,
    )
    match = re.search(r"Contract address: (0x[a-fA-F0-9]{40})", deploy.stdout)
    if not match:
        raise RuntimeError(
            f"Could not parse deployed contract address from deploy output:\n"
            f"{deploy.stdout}\n{deploy.stderr}"
        )

    os.environ["BLOCKCHAIN_RPC_URL"] = "http://127.0.0.1:8545"
    os.environ["NFT_CONTRACT_ADDRESS"] = match.group(1)
    os.environ["MINTER_PRIVATE_KEY"] = LOCAL_MINTER_PRIVATE_KEY


def pytest_unconfigure(config):
    global _node_process, _node_pid_on_port

    if _node_pid_on_port is not None:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(_node_pid_on_port)],
            capture_output=True,
        )
        _node_pid_on_port = None

    if _node_process is not None:
        _node_process.poll()
        if _node_process.returncode is None:
            _node_process.kill()
        _node_process = None
