// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title SamajhSoulbound
 * @notice Minimal ERC-721-style non-transferable Soulbound Token (SBT) anchoring
 *         Samajh's HMAC-SHA256 verified NISM understanding credentials on Polygon Amoy.
 *         One token per credentialId; re-minting the same credentialId updates its
 *         verificationHash in place without minting a duplicate.
 */
contract SamajhSoulbound {
    string public constant name = "Samajh Verified Understanding";
    string public constant symbol = "SAMAJH-SBT";

    address public immutable owner;
    uint256 private _nextTokenId = 1;

    struct CredentialRecord {
        uint256 tokenId;
        address holder;
        bytes32 verificationHash;
        uint256 updatedAt;
    }

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(bytes32 => CredentialRecord) private _byCredentialKey;
    mapping(uint256 => string) private _tokenCredentialId;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event CredentialMinted(
        uint256 indexed tokenId,
        address indexed to,
        string credentialId,
        bytes32 verificationHash
    );
    event CredentialUpdated(
        uint256 indexed tokenId,
        address indexed holder,
        string credentialId,
        bytes32 verificationHash
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "SamajhSoulbound: caller is not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Mint a new Soulbound credential token, or update verificationHash
     *         on the existing token if credentialId was already anchored.
     */
    function mint(
        address to,
        string calldata credentialId,
        bytes32 verificationHash
    ) external onlyOwner returns (uint256 tokenId) {
        require(to != address(0), "SamajhSoulbound: zero address");
        require(bytes(credentialId).length > 0, "SamajhSoulbound: empty credentialId");
        require(verificationHash != bytes32(0), "SamajhSoulbound: empty hash");

        bytes32 key = keccak256(bytes(credentialId));
        CredentialRecord storage existing = _byCredentialKey[key];

        if (existing.tokenId != 0) {
            existing.verificationHash = verificationHash;
            existing.updatedAt = block.timestamp;
            emit CredentialUpdated(existing.tokenId, existing.holder, credentialId, verificationHash);
            return existing.tokenId;
        }

        tokenId = _nextTokenId++;
        _owners[tokenId] = to;
        _balances[to] += 1;
        _tokenCredentialId[tokenId] = credentialId;

        _byCredentialKey[key] = CredentialRecord({
            tokenId: tokenId,
            holder: to,
            verificationHash: verificationHash,
            updatedAt: block.timestamp
        });

        emit Transfer(address(0), to, tokenId);
        emit CredentialMinted(tokenId, to, credentialId, verificationHash);
        return tokenId;
    }

    function getCredential(
        string calldata credentialId
    )
        external
        view
        returns (uint256 tokenId, address holder, bytes32 verificationHash, uint256 updatedAt)
    {
        CredentialRecord storage rec = _byCredentialKey[keccak256(bytes(credentialId))];
        return (rec.tokenId, rec.holder, rec.verificationHash, rec.updatedAt);
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address holder = _owners[tokenId];
        require(holder != address(0), "SamajhSoulbound: nonexistent token");
        return holder;
    }

    function balanceOf(address holder) external view returns (uint256) {
        require(holder != address(0), "SamajhSoulbound: zero address");
        return _balances[holder];
    }

    function credentialIdOf(uint256 tokenId) external view returns (string memory) {
        require(_owners[tokenId] != address(0), "SamajhSoulbound: nonexistent token");
        return _tokenCredentialId[tokenId];
    }

    // --- Soulbound Enforcement: ALL transfer & approval functions unconditionally revert ---

    function approve(address, uint256) external pure {
        revert("Soulbound: non-transferable.");
    }

    function setApprovalForAll(address, bool) external pure {
        revert("Soulbound: non-transferable.");
    }

    function transferFrom(address, address, uint256) external pure {
        revert("Soulbound: non-transferable.");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("Soulbound: non-transferable.");
    }

    function safeTransferFrom(address, address, uint256, bytes calldata) external pure {
        revert("Soulbound: non-transferable.");
    }
}
