// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/// @title SignalSubscription
/// @notice Gere les abonnements payes en USDT (Polygon Mainnet) a un service
/// de signaux de trading. Le proprietaire (adresse fixe) peut accorder des
/// essais gratuits et retirer les USDT collectes.
contract SignalSubscription is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // --- Adresses fixes (Polygon Mainnet) ---
    // USDT (PoS bridged) sur Polygon. SafeERC20 est utilise car ce token,
    // comme le USDT d'Ethereum, ne respecte pas toujours strictement le
    // retour bool standard de l'ERC20 sur transfer/transferFrom.
    IERC20 public constant USDT = IERC20(0xc2132D05D31c914a87C6611C10748AEb04B58e8F);

    // Proprietaire fixe (et non "deployer = owner") : ce contrat peut etre
    // deploye par n'importe quel wallet ayant du MATIC pour le gas, les
    // privileges (setTrial, withdraw) restent toujours attaches a cette
    // adresse precise.
    address public constant OWNER = 0x71367B5f4519700a63c2564b754cF959317E1f61;

    // --- Tarifs (USDT a 6 decimales) ---
    uint256 public constant PLAN1_PRICE = 10 * 10 ** 6; // 10 USDT
    uint256 public constant PLAN2_PRICE = 25 * 10 ** 6; // 25 USDT
    uint256 public constant SUBSCRIPTION_DURATION = 30 days;
    uint256 public constant TRIAL_DURATION = 3 days;

    // --- Etat ---
    // Timestamp (unix) auquel l'abonnement de l'utilisateur expire.
    mapping(address => uint256) public expirations;
    // Empeche un meme wallet de reclamer plusieurs essais gratuits.
    mapping(address => bool) public trialUsed;

    event Subscribed(address indexed user, uint8 plan, uint256 amount, uint256 newExpiration);
    event TrialActivated(address indexed user, uint256 newExpiration);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == OWNER, "SignalSubscription: caller is not the owner");
        _;
    }

    /// @notice Souscrit au plan choisi (1 ou 2). L'appelant doit avoir prealablement
    /// approuve ce contrat pour au moins le montant du plan :
    ///   USDT.approve(address(signalSubscription), montant)
    /// Si un abonnement est deja actif, la nouvelle periode s'ajoute a la fin
    /// de l'abonnement en cours plutot que de repartir de maintenant.
    function subscribe(uint8 plan) external nonReentrant {
        uint256 price = _planPrice(plan);

        USDT.safeTransferFrom(msg.sender, address(this), price);

        uint256 base = expirations[msg.sender] > block.timestamp
            ? expirations[msg.sender]
            : block.timestamp;
        uint256 newExpiration = base + SUBSCRIPTION_DURATION;
        expirations[msg.sender] = newExpiration;

        emit Subscribed(msg.sender, plan, price, newExpiration);
    }

    /// @notice Active un essai gratuit de 3 jours pour `user`. Reserve au
    /// proprietaire (le bot Telegram appelle cette fonction avec le wallet
    /// admin apres ses propres verifications anti-abus). Ne raccourcit
    /// jamais un abonnement payant deja actif plus long que 3 jours.
    function setTrial(address user) external onlyOwner {
        require(!trialUsed[user], "SignalSubscription: trial already used");
        trialUsed[user] = true;

        uint256 candidate = block.timestamp + TRIAL_DURATION;
        if (candidate > expirations[user]) {
            expirations[user] = candidate;
        }

        emit TrialActivated(user, expirations[user]);
    }

    /// @notice Indique si `user` a un abonnement (ou essai) actif au moment de l'appel.
    function isActive(address user) public view returns (bool) {
        return expirations[user] > block.timestamp;
    }

    /// @notice Retrait des USDT collectes par les abonnements. Reserve au proprietaire.
    function withdraw(uint256 amount) external onlyOwner {
        USDT.safeTransfer(OWNER, amount);
        emit Withdrawn(OWNER, amount);
    }

    function _planPrice(uint8 plan) internal pure returns (uint256) {
        if (plan == 1) return PLAN1_PRICE;
        if (plan == 2) return PLAN2_PRICE;
        revert("SignalSubscription: invalid plan");
    }
}
