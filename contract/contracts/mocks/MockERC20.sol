// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev ERC20 factice (6 decimales, comme USDT) utilise UNIQUEMENT par les
/// tests Hardhat. On copie son bytecode a l'adresse reelle du USDT Polygon
/// via `hardhat_setCode` pour tester SignalSubscription sans avoir besoin
/// de forker le mainnet. Jamais deploye en production.
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock USDT", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @dev Sans controle d'acces : c'est un mock de test, pas du code de prod.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
