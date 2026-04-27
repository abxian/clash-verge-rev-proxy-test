import {
  BoltRounded,
  CloudSyncRounded,
  KeyRounded,
  LanguageRounded,
  PowerSettingsNewRounded,
  ShoppingCartRounded,
  TuneRounded,
} from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useLockFn } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'

import { BasePage } from '@/components/base'
import { useProfiles } from '@/hooks/use-profiles'
import { useProxySelection } from '@/hooks/use-proxy-selection'
import { useSystemProxyState } from '@/hooks/use-system-proxy-state'
import { useSystemState } from '@/hooks/use-system-state'
import { useVerge } from '@/hooks/use-verge'
import { useAppData } from '@/providers/app-data-context'
import {
  getProfiles,
  importProfile,
  openWebUrl,
  patchClashMode,
  patchProfilesConfig,
  restartCore,
  startCore,
  stopCore,
  updateProfile,
} from '@/services/cmds'

const SUBSCRIPTION_BASE_URL = 'https://sub.jc116.com'
const CODE_STORAGE_KEY = 'shenxianyun.accessCode'

type VerifyResponse = {
  ok?: boolean
  name?: string
  expires_at?: string
  subscription_url?: string
  message?: string
}

const nodeLabel = (proxy: IProxyItem) => {
  const delay = proxy.history?.at(-1)?.delay
  const delayText = delay && delay > 0 && delay < 100000 ? ` · ${delay}ms` : ''
  return `${proxy.name}${delayText}`
}

const pickPrimaryGroup = (groups: IProxyGroupItem[] = []) => {
  const selectable = groups.filter((group) => {
    const type = String(group.type || '').toLowerCase()
    return type === 'selector' || type === 'urltest' || type === 'fallback'
  })

  return (
    selectable.find((group) =>
      ['节点', '选择', 'select', 'proxy'].some((keyword) =>
        group.name.toLowerCase().includes(keyword.toLowerCase()),
      ),
    ) ||
    selectable.find((group) =>
      group.all?.some((proxy) => !['DIRECT', 'REJECT'].includes(proxy.name)),
    ) ||
    groups[0]
  )
}

const HomePage = () => {
  const { verge, patchVerge } = useVerge()
  const { profiles, current, mutateProfiles } = useProfiles()
  const { proxies, clashConfig, refreshAll, refreshClashConfig, refreshProxy } =
    useAppData()
  const { indicator: systemProxyOn, toggleSystemProxy } = useSystemProxyState()
  const { isTunModeAvailable, mutateSystemState } = useSystemState()
  const { changeProxy } = useProxySelection({
    onSuccess: () => {
      setStatus('节点已切换')
      refreshProxy().catch(() => {})
    },
    onError: () => setStatus('节点切换失败'),
  })

  const [code, setCode] = useState('')
  const [status, setStatus] = useState('输入提取码后导入订阅。')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setCode(localStorage.getItem(CODE_STORAGE_KEY) || '')
  }, [])

  const primaryGroup = useMemo(
    () => pickPrimaryGroup((proxies?.groups || []) as IProxyGroupItem[]),
    [proxies?.groups],
  )
  const nodes = useMemo(
    () =>
      (primaryGroup?.all || []).filter(
        (proxy) => !['DIRECT', 'REJECT'].includes(proxy.name),
      ),
    [primaryGroup],
  )

  const selectedNode = primaryGroup?.now || ''
  const mode = (clashConfig?.mode || 'rule').toLowerCase()
  const tunOn = verge?.enable_tun_mode || false
  const running = tunOn || systemProxyOn
  const activeProfileName = current?.name || profiles?.current || '未导入订阅'

  const verifyCode = async (input: string): Promise<VerifyResponse> => {
    const response = await tauriFetch(
      `${SUBSCRIPTION_BASE_URL}/api/verify/${encodeURIComponent(input)}`,
      { method: 'GET', connectTimeout: 8000 },
    )
    const data = (await response.json()) as VerifyResponse
    if (!response.ok || !data.ok || !data.subscription_url) {
      throw new Error(data.message || '提取码验证失败')
    }
    return data
  }

  const activateCode = async (value: string) => {
    const data = await verifyCode(value)
    await importProfile(data.subscription_url!, {
      with_proxy: true,
      allow_auto_update: true,
      update_interval: 60,
    })

    const latestProfiles = await getProfiles()
    const newestProfile = latestProfiles.items?.at(-1)
    if (newestProfile?.uid) {
      await patchProfilesConfig({ ...latestProfiles, current: newestProfile.uid })
    }

    localStorage.setItem(CODE_STORAGE_KEY, value)
    await mutateProfiles()
    await refreshAll()
    return data
  }

  const importByCode = useLockFn(async () => {
    const value = code.trim()
    if (!value) {
      setStatus('请输入提取码')
      return
    }

    setBusy(true)
    setStatus('正在验证提取码...')
    try {
      const data = await activateCode(value)
      setStatus(
        `订阅已导入：${data.name || value}${
          data.expires_at ? `，到期 ${data.expires_at}` : ''
        }`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const updateCurrentSubscription = useLockFn(async () => {
    if (!current?.uid) {
      setStatus('还没有可更新的订阅')
      return
    }
    setBusy(true)
    setStatus('正在更新订阅...')
    try {
      await updateProfile(current.uid, { with_proxy: true })
      await mutateProfiles()
      await refreshAll()
      setStatus('订阅已更新')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const togglePower = useLockFn(async () => {
    setBusy(true)
    try {
      if (running) {
        if (tunOn) await patchVerge({ enable_tun_mode: false })
        if (systemProxyOn) await toggleSystemProxy(false)
        await stopCore().catch(() => {})
        setStatus('已停止代理')
        await refreshAll()
        return
      }

      if (!current?.uid) {
        const value = code.trim()
        if (!value) {
          setStatus('请先输入提取码并导入订阅')
          return
        }
        setStatus('正在导入订阅...')
        await activateCode(value)
      }

      setStatus('正在启动内核...')
      await startCore().catch(() => restartCore())
      await mutateSystemState()

      if (isTunModeAvailable) {
        await patchVerge({ enable_tun_mode: true })
        if (systemProxyOn) await toggleSystemProxy(false)
        setStatus('已启动 TUN 模式')
      } else {
        await toggleSystemProxy(true)
        setStatus('已启动系统代理')
      }
      await refreshAll()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const changeMode = useLockFn(async (_: unknown, value: string | null) => {
    if (!value || value === mode) return
    setBusy(true)
    try {
      await patchClashMode(value)
      await refreshClashConfig()
      setStatus(value === 'global' ? '已切换全局模式' : '已切换规则模式')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  })

  const changeNode = (value: string) => {
    if (!primaryGroup || !value) return
    changeProxy(primaryGroup.name, value, primaryGroup.now)
  }

  return (
    <BasePage title="神仙云">
      <Box
        sx={{
          minHeight: '100%',
          display: 'grid',
          placeItems: 'center',
          px: 3,
          py: 4,
          background:
            'radial-gradient(circle at 50% 18%, rgba(255,80,145,.16), transparent 34%), linear-gradient(180deg, rgba(16,18,28,.04), transparent)',
        }}
      >
        <Stack spacing={3} sx={{ width: 'min(720px, 100%)' }}>
          <Stack spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h3" sx={{ fontWeight: 800 }}>
              神仙云
            </Typography>
            <Typography color="text.secondary">
              输入提取码，选择节点，一键开启。
            </Typography>
          </Stack>

          <Paper
            elevation={0}
            sx={{
              borderRadius: 4,
              p: { xs: 3, md: 4 },
              border: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <Stack spacing={3} sx={{ alignItems: 'center' }}>
              <Button
                disabled={busy}
                onClick={togglePower}
                sx={{
                  width: 220,
                  height: 220,
                  borderRadius: '50%',
                  fontSize: 32,
                  fontWeight: 800,
                  color: 'white',
                  bgcolor: running ? '#2ac77f' : '#f25b96',
                  boxShadow: running
                    ? '0 18px 42px rgba(42,199,127,.35)'
                    : '0 18px 42px rgba(242,91,150,.35)',
                  '&:hover': {
                    bgcolor: running ? '#24b472' : '#e94f8b',
                  },
                }}
              >
                <Stack spacing={1} sx={{ alignItems: 'center' }}>
                  <PowerSettingsNewRounded sx={{ fontSize: 56 }} />
                  <span>{running ? '停止' : '启动'}</span>
                </Stack>
              </Button>

              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ flexWrap: 'wrap' }}
              >
                <Chip
                  icon={<BoltRounded />}
                  color={running ? 'success' : 'default'}
                  label={running ? '代理已开启' : '代理未开启'}
                />
                <Chip icon={<TuneRounded />} label={activeProfileName} />
                <Chip
                  icon={<LanguageRounded />}
                  label={mode === 'global' ? '全局模式' : '规则模式'}
                />
              </Stack>

              <ToggleButtonGroup
                exclusive
                value={mode}
                onChange={changeMode}
                disabled={busy}
                fullWidth
                sx={{ maxWidth: 420 }}
              >
                <ToggleButton value="rule">规则模式</ToggleButton>
                <ToggleButton value="global">全局模式</ToggleButton>
              </ToggleButtonGroup>

              <FormControl fullWidth>
                <InputLabel>选择节点</InputLabel>
                <Select
                  label="选择节点"
                  value={selectedNode}
                  onChange={(event) => changeNode(event.target.value)}
                  disabled={!primaryGroup || nodes.length === 0}
                >
                  {nodes.map((node) => (
                    <MenuItem key={node.name} value={node.name}>
                      {nodeLabel(node)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ width: '100%' }}
              >
                <TextField
                  fullWidth
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  label="提取码"
                  placeholder="输入网页后台生成的提取码"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <KeyRounded sx={{ mr: 1, color: 'text.secondary' }} />
                      ),
                    },
                  }}
                />
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={importByCode}
                  sx={{ minWidth: 140 }}
                >
                  导入订阅
                </Button>
              </Stack>

              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ width: '100%' }}
              >
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<CloudSyncRounded />}
                  disabled={busy}
                  onClick={updateCurrentSubscription}
                >
                  更新订阅
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  startIcon={<ShoppingCartRounded />}
                  onClick={() => openWebUrl(`${SUBSCRIPTION_BASE_URL}/pay`)}
                >
                  新购 / 续费
                </Button>
              </Stack>

              <Alert
                severity={
                  status.includes('失败') || status.includes('错误')
                    ? 'error'
                    : 'info'
                }
                sx={{ width: '100%' }}
              >
                {status}
              </Alert>
            </Stack>
          </Paper>
        </Stack>
      </Box>
    </BasePage>
  )
}

export default HomePage
