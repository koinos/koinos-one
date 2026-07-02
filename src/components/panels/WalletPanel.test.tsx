import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { translate } from '../../i18n'
import { WalletPanel } from './WalletPanel'

const t = (key: string, values?: Record<string, string | number>) => translate('en', key, values)

function walletOverview(): TelenoWalletOverviewResult {
  return {
    ok: true,
    output: 'Wallet ready',
    network: 'mainnet',
    walletExists: true,
    unlocked: true,
    walletAddress: '16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N',
    activeAccountId: 'account-1',
    activeAccountName: 'Account 1',
    activeAccountKind: 'seed',
    accountCount: 1,
    hasSeedPhrase: true,
    accounts: [{
      id: 'account-1',
      name: 'Account 1',
      address: '16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N',
      kind: 'seed',
      hasPrivateKey: true,
      derivationPath: "m/44'/659'/0'/0/0"
    }]
  } as TelenoWalletOverviewResult
}

describe('WalletPanel setup mode', () => {
  it('hides raw wallet action output in the first-run assistant', () => {
    const html = renderToStaticMarkup(
      <WalletPanel
        t={t}
        setupMode
        advancedMode
        hasWalletControls
        walletOverview={walletOverview()}
        walletLoading={false}
        walletActionLoading={null}
        walletError={null}
        nativeTokenSymbol="KOIN"
        walletResultTitle="Create wallet"
        walletResultText={'{"ok":true,"output":"Wallet created and imported."}'}
        walletResultData={{ ok: true }}
        activeWalletAccountId="account-1"
        activeWalletAddress="16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N"
        activeWalletCanSign
        walletBalance={null}
        walletImportPrivateKey=""
        setWalletImportPrivateKey={vi.fn()}
        walletImportPassword=""
        setWalletImportPassword={vi.fn()}
        walletImportSeedPhrase=""
        setWalletImportSeedPhrase={vi.fn()}
        walletImportSeedPassword=""
        setWalletImportSeedPassword={vi.fn()}
        walletUnlockPassword=""
        setWalletUnlockPassword={vi.fn()}
        unlockWalletAccount={vi.fn()}
        importWalletAccount={vi.fn()}
        importWalletFromSeed={vi.fn()}
        createWalletAccount={vi.fn()}
        generateWalletDraft={vi.fn()}
        showWalletSeed={vi.fn()}
        closeWalletAccount={vi.fn()}
        deleteWalletAccount={vi.fn()}
        walletTransferAsset="koin"
        setWalletTransferAsset={vi.fn()}
        walletTransferAddressDraft=""
        setWalletTransferAddressDraft={vi.fn()}
        walletTransferAmountDraft=""
        setWalletTransferAmountDraft={vi.fn()}
        walletTransferDryRun
        setWalletTransferDryRun={vi.fn()}
        walletTransferUseFreeMana={false}
        setWalletTransferUseFreeMana={vi.fn()}
        transferWalletToken={vi.fn()}
        walletBurnTargetAddressDraft=""
        setWalletBurnTargetAddressDraft={vi.fn()}
        walletBurnPercentDraft="95"
        setWalletBurnPercentDraft={vi.fn()}
        walletBurnAmountDraft=""
        setWalletBurnAmountDraft={vi.fn()}
        walletBurnDryRun
        setWalletBurnDryRun={vi.fn()}
        walletBurnUseFreeMana={false}
        setWalletBurnUseFreeMana={vi.fn()}
        burnKoinToVhp={vi.fn()}
        setWalletActiveAccount={vi.fn()}
        setWalletAccountAsProducer={vi.fn()}
        createWalletDerivedAccount={vi.fn()}
        importWalletWatchAccount={vi.fn()}
        renameWalletVaultAccount={vi.fn()}
        removeWalletVaultAccount={vi.fn()}
      />
    )

    expect(html).toContain('Use this wallet?')
    expect(html).toContain('Keep this wallet')
    expect(html).toContain('Create new wallet')
    expect(html).toContain('Import WIF')
    expect(html).toContain('Import seed')
    expect(html).toContain('16VX7BrVScLMhJqFxdnnJcuLnsFebTEc5N')
    expect(html).not.toContain('wallet-output')
    expect(html).not.toContain('Create wallet')
    expect(html).not.toContain('Wallet created and imported')
    expect(html).not.toContain('&quot;ok&quot;')
  })
})
