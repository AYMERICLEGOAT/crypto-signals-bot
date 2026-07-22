const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { time, impersonateAccount, setBalance } = require("@nomicfoundation/hardhat-network-helpers");

// Adresses hardcodées dans le contrat (voir SignalSubscription.sol).
const USDT_ADDRESS = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const OWNER_ADDRESS = "0x71367B5f4519700a63c2564b754cF959317E1f61";

const PLAN1_PRICE = 10n * 10n ** 6n; // 10 USDT
const PLAN2_PRICE = 25n * 10n ** 6n; // 25 USDT
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const THREE_DAYS = 3 * 24 * 60 * 60;

describe("SignalSubscription", function () {
  let subscription, usdt, user, other, ownerSigner;

  beforeEach(async function () {
    [, user, other] = await ethers.getSigners();

    // On déploie un ERC20 mock puis on copie son bytecode à l'adresse USDT
    // réelle (hardhat_setCode), ce qui permet de tester subscribe()/withdraw()
    // sans avoir à forker le mainnet Polygon.
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const mock = await MockERC20.deploy();
    await mock.waitForDeployment();
    const mockCode = await ethers.provider.getCode(await mock.getAddress());
    await network.provider.send("hardhat_setCode", [USDT_ADDRESS, mockCode]);
    usdt = await ethers.getContractAt("MockERC20", USDT_ADDRESS);

    await usdt.mint(user.address, 1_000n * 10n ** 6n);
    await usdt.mint(other.address, 1_000n * 10n ** 6n);

    const Subscription = await ethers.getContractFactory("SignalSubscription");
    subscription = await Subscription.deploy();
    await subscription.waitForDeployment();

    // Permet de signer des transactions "en tant que" OWNER dans les tests,
    // puisque OWNER est une adresse fixe, pas un des signers Hardhat par défaut.
    await impersonateAccount(OWNER_ADDRESS);
    await setBalance(OWNER_ADDRESS, ethers.parseEther("10"));
    ownerSigner = await ethers.getSigner(OWNER_ADDRESS);
  });

  it("refuse subscribe() sans approve préalable", async function () {
    await expect(subscription.connect(user).subscribe(1)).to.be.reverted;
  });

  it("active un abonnement de 30 jours après approve + subscribe(1)", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN1_PRICE);
    const tx = await subscription.connect(user).subscribe(1);
    await expect(tx).to.emit(subscription, "Subscribed");

    expect(await subscription.isActive(user.address)).to.equal(true);
    expect(await usdt.balanceOf(await subscription.getAddress())).to.equal(PLAN1_PRICE);

    const expiration = await subscription.expirations(user.address);
    const nowBlock = await ethers.provider.getBlock("latest");
    expect(Number(expiration)).to.be.closeTo(nowBlock.timestamp + THIRTY_DAYS, 5);
  });

  it("plan 2 débite bien 25 USDT", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN2_PRICE);
    await subscription.connect(user).subscribe(2);
    expect(await usdt.balanceOf(await subscription.getAddress())).to.equal(PLAN2_PRICE);
  });

  it("rejette un plan invalide", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN2_PRICE);
    await expect(subscription.connect(user).subscribe(3)).to.be.revertedWith(
      "SignalSubscription: invalid plan"
    );
  });

  it("prolonge un abonnement déjà actif au lieu de repartir de maintenant", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN1_PRICE * 2n);
    await subscription.connect(user).subscribe(1);
    const firstExpiration = await subscription.expirations(user.address);

    await subscription.connect(user).subscribe(1);
    const secondExpiration = await subscription.expirations(user.address);

    expect(secondExpiration).to.equal(firstExpiration + BigInt(THIRTY_DAYS));
  });

  it("devient inactif après expiration", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN1_PRICE);
    await subscription.connect(user).subscribe(1);

    await time.increase(THIRTY_DAYS + 1);

    expect(await subscription.isActive(user.address)).to.equal(false);
  });

  it("refuse setTrial() par un compte autre que OWNER", async function () {
    await expect(subscription.connect(user).setTrial(other.address)).to.be.revertedWith(
      "SignalSubscription: caller is not the owner"
    );
  });

  it("active un essai de 3 jours via OWNER, une seule fois", async function () {
    await subscription.connect(ownerSigner).setTrial(user.address);
    expect(await subscription.isActive(user.address)).to.equal(true);
    expect(await subscription.trialUsed(user.address)).to.equal(true);

    const expiration = await subscription.expirations(user.address);
    const nowBlock = await ethers.provider.getBlock("latest");
    expect(Number(expiration)).to.be.closeTo(nowBlock.timestamp + THREE_DAYS, 5);

    await expect(subscription.connect(ownerSigner).setTrial(user.address)).to.be.revertedWith(
      "SignalSubscription: trial already used"
    );
  });

  it("l'essai gratuit ne raccourcit pas un abonnement payant plus long", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN1_PRICE);
    await subscription.connect(user).subscribe(1); // 30 jours
    const expirationAvantEssai = await subscription.expirations(user.address);

    await subscription.connect(ownerSigner).setTrial(user.address); // 3 jours < 30 jours restants
    const expirationApresEssai = await subscription.expirations(user.address);

    expect(expirationApresEssai).to.equal(expirationAvantEssai);
  });

  it("permet à OWNER de retirer les USDT collectés", async function () {
    await usdt.connect(user).approve(await subscription.getAddress(), PLAN1_PRICE);
    await subscription.connect(user).subscribe(1);

    const ownerBalanceBefore = await usdt.balanceOf(OWNER_ADDRESS);
    await subscription.connect(ownerSigner).withdraw(PLAN1_PRICE);
    const ownerBalanceAfter = await usdt.balanceOf(OWNER_ADDRESS);

    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(PLAN1_PRICE);
  });

  it("refuse withdraw() par un compte autre que OWNER", async function () {
    await expect(subscription.connect(user).withdraw(1)).to.be.revertedWith(
      "SignalSubscription: caller is not the owner"
    );
  });
});
