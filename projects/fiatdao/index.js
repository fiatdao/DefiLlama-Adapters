const sdk = require("@defillama/sdk")
const { default: BigNumber } = require("bignumber.js")
const abi = require('./abi.json')

const { sumTokensAndLPsSharedOwners } = require("../helper/unwrapLPs")
const { fetchURL } = require("../helper/utils")

const STAKING_CONTRACT = "0xe98ae8cD25CDC06562c29231Db339d17D02Fd486"
const STAKING_NFT = "0xE9F9936a639809e766685a436511eac3Fb1C85bC"
const RGT = "0xD291E7a03283640FDc51b121aC401383A46cC623"
const YFI = "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e"
const MKR = "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2"
const BOND = "0x0391D2021f89DC339F60Fff84546EA23E337750f"
const UMA = "0x04Fa0d235C4abf4BcF4787aF4CF447DE572eF828"
const GOHM = "0x0ab87046fbb341d058f17cbc4c1133f25a20a52f"
const WSOHM = "0xca76543cf381ebbb277be79574059e32108e3e65"
const WSOHM_FDT_SLP = "0x2e30e758b3950dd9afed2e21f5ab82156fbdbbba"
const FDT_GOHM = "0x75b02b9889536B617d57D08c1Ccb929c523945C1"

const LUSD = '0x5f98805a4e8be255a32880fdec7f6728c6568ba0'
const LUSD3CRV = '0xEd279fDD11cA84bEef15AF5D39BB4d4bEE23F0cA'

function resolveUnderlier(underlier) {
  if (underlier == LUSD3CRV) return LUSD
  return underlier
}

// Launch Ceremony
async function staking(timestamp, block) {
  const balances = {}

  await sumTokensAndLPsSharedOwners(
    balances,
    [
      [WSOHM, false],
      [RGT, false],
      [YFI, false],
      [MKR, false],
      [BOND, false],
      [UMA, false],
      [WSOHM_FDT_SLP, true],
      [FDT_GOHM, true],
    ],
    [STAKING_CONTRACT, STAKING_NFT],
    block,
    "ethereum",
    (addr) => {
      if (addr.toLowerCase() === WSOHM.toLowerCase()) return GOHM
      return addr
    }
  )

  return balances
}

// Protocol TVL
async function tvl(timestamp, block) {
  const balances = {};

  const metadata = (await fetchURL('https://raw.githubusercontent.com/fiatdao/changelog/main/metadata/metadata-mainnet.json')).data
  const allVaults = Object.keys(metadata)
  const { output: tokensAll } = await sdk.api.abi.multiCall({ abi: abi.token, calls: allVaults.map(i => ({ target: i })), block, })
  const tokens = []
  const vaults = []

  tokensAll.forEach(({ output, input: { target } }) => {
    if (output !== '0x0000000000000000000000000000000000000000') {
      vaults.push(target)
      tokens.push(output)
    }
  })

  const vaultCalls = vaults.map(i => ({ target: i }))
  const { output: tokenScales } = await sdk.api.abi.multiCall({ abi: abi.tokenScale, calls: vaultCalls, block, })
  const { output: underliers } = await sdk.api.abi.multiCall({ abi: abi.underlierToken, calls: vaultCalls, block, })
  const { output: underlierScales } = await sdk.api.abi.multiCall({ abi: abi.underlierScale, calls: vaultCalls, block, })

  const erc20Metadata = []
  const erc1155Metadata = []

  underliers.forEach(({ output: token, input: { target: vault } }, i) => {
    const underlier = resolveUnderlier(token)
    const scale = BigNumber(underlierScales[i].output / (tokenScales[i].output * 1e18))
    metadata[vault].tokenIds.forEach(id => {
      if (id === '0') {
        erc20Metadata.push({ vault, scale, underlier, tokenCall: { target: tokens[i], params: vault }, priceCall: { target: vault, params: [0, false, false] } })
        return;
      }
      erc1155Metadata.push({ vault, scale, underlier, tokenCall: { target: tokens[i], params: [vault, id] }, priceCall: { target: vault, params: [id, false, false] } })
    })
  })

  const { output: erc20Balances } = await sdk.api.abi.multiCall({ abi: 'erc20:balanceOf', calls: erc20Metadata.map(i => i.tokenCall), block, })
  const { output: erc20Prices } = await sdk.api.abi.multiCall({ abi: abi.fairPrice, calls: erc20Metadata.map(i => i.priceCall), block, })
  const { output: erc1155Balances } = await sdk.api.abi.multiCall({ abi: abi.balanceOf, calls: erc1155Metadata.map(i => i.tokenCall), block, })
  const { output: erc1155Prices } = await sdk.api.abi.multiCall({ abi: abi.fairPrice, calls: erc1155Metadata.map(i => i.priceCall), block, })

  erc20Balances.forEach(({ output, }, i) => {
    sdk.util.sumSingleBalance(balances, erc20Metadata[i].underlier, erc20Metadata[i].scale.times(output).times(erc20Prices[i].output).toFixed(0))
  })

  erc1155Balances.forEach(({ output, }, i) => {
    sdk.util.sumSingleBalance(balances, erc1155Metadata[i].underlier, erc1155Metadata[i].scale.times(output).times(erc1155Prices[i].output).toFixed(0))
  })

  return balances
}

module.exports = {
  methodology: 'TVL includes fair value of collateral backing outstanding $FIAT and the initial FDT Jubilee event',
  ethereum: { tvl, staking: staking },
  hallmarks:[
    [13542757, "FDT Jubilee starts"],
    [13795215, "FDT Jubilee ends"],
    [14558571, "Protocol Launch"]
  ]
}
