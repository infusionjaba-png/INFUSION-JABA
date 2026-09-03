"use client"

import { useState, useEffect, useMemo, useCallback } from "react"
import { Header } from "@/components/layout/header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { toast as sonnerToast } from "sonner"
import { staff } from "@/lib/dummy-data"
import { Building, Users, Bell, Shield, Printer, Receipt, Smartphone, Loader2, Truck, MapPin, Store, Clock, Plus, Trash2, Activity, AlertTriangle, RefreshCw, Lock, ShieldCheck, MessageSquare } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  defaultEcommerceOpeningHours,
  evaluateEcommerceOpeningHours,
  validateEcommerceOpeningHoursPayload,
  type EcommerceOpeningHoursSettings,
} from "@/lib/ecommerce-opening-hours"
import { normalizeKenyaPhone, getPhoneValidationError } from "@/lib/phone-utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { normalizePhoneNumbers } from "@/lib/phone-normalize"
import Link from "next/link"

const EO_DAY_DEFS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
]

interface Settings {
  businessInfo?: {
    businessName: string
    phone: string
    address: string
    currency: string
    vatRate: number
  }
  receipt?: {
    autoPrint: boolean
    includeVatBreakdown: boolean
    footerMessage: string
  }
  notifications?: {
    lowStockAlerts: boolean
    dailySalesSummary: boolean
    newOrderNotifications: boolean
    supplierDeliveryReminders: boolean
    securitySmsAlertsEnabled?: boolean
    securityAlertNumbers?: string[]
    shiftNotificationPhones?: string[]
    onlineOrderSmsPhones?: string[]
    securityDeniedBurstThreshold?: number
    manualMpesaApprovalSmsEnabled?: boolean
    manualMpesaApprovalPhones?: string[]
    manualMpesaApprovalLinkExpiryMinutes?: number
    mpesaIntegrationPhoneConfigured?: boolean
    mpesaIntegrationPhoneMasked?: string | null
  }
  security?: {
    requirePinForVoids: boolean
    autoLogout: string
    twoFactorAuth: boolean
  }
  etims?: {
    enabled: boolean
    environment: 'sandbox' | 'production'
    taxpayerPin: string
    branchOfficeId: string
    communicationKey: string
    equipmentInfo?: string
  }
  mpesa?: {
    enabled: boolean
    environment: 'sandbox' | 'production'
    consumerKey: string
    consumerSecret: string
    passkey: string
    shortcode: string
    confirmationUrl: string
    validationUrl: string
    callbackUrl: string
    credentialsConfigured?: boolean
  }
  delivery?: {
    pickupAddress: string
    pickupDirectionsUrl?: string
    options: Array<{
      value: string
      label: string
      fee: number
      subtext: string
      enabled: boolean
    }>
  }
  ecommerceOpeningHours?: EcommerceOpeningHoursSettings
}

type DeliveryOption = {
  value: string
  label: string
  fee: number
  subtext: string
  enabled: boolean
}

type AuthHealthResponse = {
  success: boolean
  summary: {
    starts: number
    success: number
    successRate: number
    busyLocks: number
    stateMismatch: number
    googleAccountMissing: number
    rateLimited: number
    sessionWaitTimeouts: number
    timeoutRate: number
    busyLockRate: number
    stateMismatchRate: number
    avgDurationMs: number | null
    maxDurationMs: number | null
  }
  alerts: Array<{
    code: string
    severity: "info" | "warning" | "critical"
    message: string
    current: number
    threshold: number
  }>
  daily: Array<{ day: string; type: string; count: number }>
  failuresByReason: Array<{ reason: string; count: number }>
  topReturnPaths: Array<{ path: string; count: number }>
  deviceSplit: Array<{ device: string; count: number }>
}

type SmsDashboardMetrics = {
  total: number
  successRate: number
  failureRate: number
  pending: number
  unresolvedCriticalAlerts: number
}

const DEFAULT_DELIVERY_OPTIONS: DeliveryOption[] = [
  { value: "deliver_to_my_location", label: "Deliver to My Location", fee: 1000, subtext: "Delivery fee applies", enabled: true },
  { value: "collect_at_catha_lodge", label: "Collect at Catha Lounge", fee: 0, subtext: "No delivery fee", enabled: true },
  { value: "nairobi_cbd", label: "Deliver within Nairobi CBD", fee: 450, subtext: "KES 450 delivery", enabled: true },
  { value: "westlands", label: "Deliver within Westlands", fee: 350, subtext: "KES 350 delivery", enabled: true },
  { value: "kilimani", label: "Deliver within Kilimani", fee: 200, subtext: "KES 200 delivery", enabled: true },
]

export default function SettingsPage() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  
  // Business Info State
  const [businessName, setBusinessName] = useState("Catha Lounge")
  const [phone, setPhone] = useState("+254 712 345678")
  const [address, setAddress] = useState("Westlands, Nairobi, Kenya")
  const [currency, setCurrency] = useState("kes")
  const [vatRate, setVatRate] = useState(16)
  
  // Receipt Settings State
  const [autoPrint, setAutoPrint] = useState(true)
  const [includeVatBreakdown, setIncludeVatBreakdown] = useState(true)
  const [footerMessage, setFooterMessage] = useState("Thank you for visiting!")
  
  // Notifications State
  const [lowStockAlerts, setLowStockAlerts] = useState(true)
  const [dailySalesSummary, setDailySalesSummary] = useState(true)
  const [newOrderNotifications, setNewOrderNotifications] = useState(false)
  const [supplierDeliveryReminders, setSupplierDeliveryReminders] = useState(true)
  const [securitySmsAlertsEnabled, setSecuritySmsAlertsEnabled] = useState(false)
  const [securityAlertNumbersText, setSecurityAlertNumbersText] = useState("")
  const [shiftNotificationPhonesText, setShiftNotificationPhonesText] = useState("")
  const [onlineOrderSmsPhonesText, setOnlineOrderSmsPhonesText] = useState("")
  const [manualMpesaApprovalSmsEnabled, setManualMpesaApprovalSmsEnabled] = useState(false)
  const [manualMpesaApprovalPhonesText, setManualMpesaApprovalPhonesText] = useState("")
  const [manualMpesaApprovalLinkExpiryMinutes, setManualMpesaApprovalLinkExpiryMinutes] = useState(60)
  const [securityDeniedBurstThreshold, setSecurityDeniedBurstThreshold] = useState(10)
  
  // Security State
  const [requirePinForVoids, setRequirePinForVoids] = useState(true)
  const [autoLogout, setAutoLogout] = useState("15")
  const [twoFactorAuth, setTwoFactorAuth] = useState(false)
  
  // eTIMS State
  const [etimsEnabled, setEtimsEnabled] = useState(false)
  const [etimsEnvironment, setEtimsEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [taxpayerPin, setTaxpayerPin] = useState("")
  const [branchOfficeId, setBranchOfficeId] = useState("")
  const [communicationKey, setCommunicationKey] = useState("")
  const [equipmentInfo, setEquipmentInfo] = useState("")

  // M-Pesa State
  const [mpesaEnabled, setMpesaEnabled] = useState(false)
  const [mpesaEnvironment, setMpesaEnvironment] = useState<'sandbox' | 'production'>('sandbox')
  const [consumerKey, setConsumerKey] = useState("")
  const [consumerSecret, setConsumerSecret] = useState("")
  const [passkey, setPasskey] = useState("")
  const [shortcode, setShortcode] = useState("")
  const [confirmationUrl, setConfirmationUrl] = useState("")
  const [validationUrl, setValidationUrl] = useState("")
  const [callbackUrl, setCallbackUrl] = useState("")
  const [registeringUrls, setRegisteringUrls] = useState(false)

  // M-Pesa integration security
  const [mpesaIntegrationConfigured, setMpesaIntegrationConfigured] = useState(false)
  const [mpesaIntegrationMasked, setMpesaIntegrationMasked] = useState<string | null>(null)
  const [mpesaIntegrationPhoneInput, setMpesaIntegrationPhoneInput] = useState("")
  const [mpesaChangeNewPhoneInput, setMpesaChangeNewPhoneInput] = useState("")
  const [mpesaChangeToken, setMpesaChangeToken] = useState<string | null>(null)
  const [mpesaChangeStep, setMpesaChangeStep] = useState<0 | 1 | 2>(0)
  const [mpesaEditUnlocked, setMpesaEditUnlocked] = useState(false)
  const [mpesaEditToken, setMpesaEditToken] = useState<string | null>(null)
  const [mpesaEditExpiresAt, setMpesaEditExpiresAt] = useState<Date | null>(null)
  const [otpDialogOpen, setOtpDialogOpen] = useState(false)
  const [otpDialogTitle, setOtpDialogTitle] = useState("")
  const [otpDialogDescription, setOtpDialogDescription] = useState("")
  const [otpValue, setOtpValue] = useState("")
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [pendingOtpAction, setPendingOtpAction] = useState<
    | 'unlock_mpesa_edit'
    | 'register_integration_phone'
    | 'change_integration_phone_step1'
    | 'change_integration_phone_step2'
    | null
  >(null)
  const [pendingOtpNewPhone, setPendingOtpNewPhone] = useState<string | undefined>(undefined)

  // Delivery / E-commerce checkout settings
  const [pickupAddress, setPickupAddress] = useState("Catha Lounge – Nairobi (exact address confirmed at order)")
  const [pickupDirectionsUrl, setPickupDirectionsUrl] = useState("")
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>(DEFAULT_DELIVERY_OPTIONS)

  const [eoEnabled, setEoEnabled] = useState(false)
  const [eoOpenTime, setEoOpenTime] = useState(defaultEcommerceOpeningHours.openingTime)
  const [eoCloseTime, setEoCloseTime] = useState(defaultEcommerceOpeningHours.closingTime)
  const [eoOpenDays, setEoOpenDays] = useState<number[]>([...defaultEcommerceOpeningHours.openDays])
  const [eoCustomNotice, setEoCustomNotice] = useState("")
  const [eoBlockCheckout, setEoBlockCheckout] = useState(false)

  // Auth health panel
  const [authHealthDays, setAuthHealthDays] = useState("7")
  const [authHealthLoading, setAuthHealthLoading] = useState(false)
  const [authHealthError, setAuthHealthError] = useState("")
  const [authHealth, setAuthHealth] = useState<AuthHealthResponse | null>(null)
  const [shiftOpeningTime, setShiftOpeningTime] = useState("08:00")
  const [shiftClosingTime, setShiftClosingTime] = useState("23:00")
  const [noShiftReminderMinutes, setNoShiftReminderMinutes] = useState(10)
  const [noShiftHardAlertMinutes, setNoShiftHardAlertMinutes] = useState(20)
  const [autoCloseGraceHours, setAutoCloseGraceHours] = useState(2)
  const [continuePromptWindowHours, setContinuePromptWindowHours] = useState(24)
  const [smsMetrics, setSmsMetrics] = useState<SmsDashboardMetrics | null>(null)

  // SMS gateway (Zettatel) — settings override env when filled
  const [smsGwUserId, setSmsGwUserId] = useState("")
  const [smsGwPassword, setSmsGwPassword] = useState("")
  const [smsGwApiKey, setSmsGwApiKey] = useState("")
  const [smsGwSenderId, setSmsGwSenderId] = useState("")
  const [smsGwApiUrl, setSmsGwApiUrl] = useState("")
  const [smsGwMsgType, setSmsGwMsgType] = useState("text")
  const [smsGwAdminOtpPhones, setSmsGwAdminOtpPhones] = useState("")
  const [smsGwConfigured, setSmsGwConfigured] = useState(false)
  const [smsGwPasswordConfigured, setSmsGwPasswordConfigured] = useState(false)
  const [smsGwApiKeyConfigured, setSmsGwApiKeyConfigured] = useState(false)
  const [smsGwEnvFallback, setSmsGwEnvFallback] = useState<Record<string, boolean>>({})
  const [smsGwLoading, setSmsGwLoading] = useState(false)
  const [smsGwSaving, setSmsGwSaving] = useState(false)
  const [smsGwTesting, setSmsGwTesting] = useState(false)
  const [smsGwTestPhone, setSmsGwTestPhone] = useState("")

  const eoPreview = useMemo(
    () =>
      evaluateEcommerceOpeningHours(
        {
          enabled: eoEnabled,
          openingTime: eoOpenTime,
          closingTime: eoCloseTime,
          openDays: eoOpenDays,
          customNotice: eoCustomNotice,
          blockCheckoutWhenClosed: eoBlockCheckout,
        },
        new Date()
      ),
    [eoEnabled, eoOpenTime, eoCloseTime, eoOpenDays, eoCustomNotice, eoBlockCheckout]
  )

  const mpesaFieldsLocked = !mpesaEditUnlocked

  useEffect(() => {
    if (!mpesaEditExpiresAt) return
    const ms = mpesaEditExpiresAt.getTime() - Date.now()
    if (ms <= 0) {
      setMpesaEditUnlocked(false)
      setMpesaEditToken(null)
      setMpesaEditExpiresAt(null)
      return
    }
    const timer = window.setTimeout(() => {
      setMpesaEditUnlocked(false)
      setMpesaEditToken(null)
      setMpesaEditExpiresAt(null)
      toast({
        title: "M-Pesa settings locked",
        description: "Your edit session expired. Verify OTP again to continue editing.",
      })
    }, ms)
    return () => window.clearTimeout(timer)
  }, [mpesaEditExpiresAt, toast])

  const loadUnlockedMpesaSettings = async (token: string) => {
    const response = await fetch('/api/catha/mpesa-settings-unlock', {
      headers: { 'x-mpesa-edit-token': token },
      cache: 'no-store',
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Failed to load unlocked M-Pesa settings')
    }
    const mpesa = data.mpesa
    if (mpesa) {
      setConsumerKey(mpesa.consumerKey || "")
      setConsumerSecret(mpesa.consumerSecret || "")
      setPasskey(mpesa.passkey || "")
      setShortcode(mpesa.shortcode || "")
      setConfirmationUrl(mpesa.confirmationUrl || "")
      setValidationUrl(mpesa.validationUrl || "")
      setCallbackUrl(mpesa.callbackUrl || "")
      setMpesaEnabled(!!mpesa.enabled)
      setMpesaEnvironment(mpesa.environment === 'production' ? 'production' : 'sandbox')
    }
  }

  const openOtpDialog = (
    action: NonNullable<typeof pendingOtpAction>,
    title: string,
    description: string,
    newPhone?: string
  ) => {
    setPendingOtpAction(action)
    setPendingOtpNewPhone(newPhone)
    setOtpDialogTitle(title)
    setOtpDialogDescription(description)
    setOtpValue("")
    setOtpDialogOpen(true)
  }

  const requestIntegrationOtp = async (
    action: NonNullable<typeof pendingOtpAction>,
    newPhone?: string,
    changeToken?: string
  ) => {
    setOtpSending(true)
    try {
      const response = await fetch('/api/catha/mpesa-integration-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, newPhone, changeToken }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        const errMsg = String(data.error || 'Failed to send OTP')
        console.error('[M-Pesa OTP send failed]', {
          status: response.status,
          error: errMsg,
          action,
        })
        throw new Error(errMsg)
      }
      toast({
        title: "OTP sent",
        description: data.maskedDestination
          ? `Verification code sent to ${data.maskedDestination}`
          : "Check the integration phone for your code.",
      })
      return true
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send OTP'
      toast({
        title: /invalid login|zettatel|sms gateway/i.test(message) ? 'SMS send failed' : 'Error',
        description: message,
        variant: 'destructive',
      })
      return false
    } finally {
      setOtpSending(false)
    }
  }

  const verifyIntegrationOtp = async () => {
    if (!pendingOtpAction || otpValue.length !== 6) return
    setOtpVerifying(true)
    try {
      const response = await fetch('/api/catha/mpesa-integration-otp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: pendingOtpAction,
          otp: otpValue,
          newPhone: pendingOtpNewPhone,
          changeToken: mpesaChangeToken,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'OTP verification failed')
      }

      if (pendingOtpAction === 'unlock_mpesa_edit' && data.editToken) {
        setMpesaEditToken(data.editToken)
        setMpesaEditUnlocked(true)
        setMpesaEditExpiresAt(data.editExpiresAt ? new Date(data.editExpiresAt) : null)
        await loadUnlockedMpesaSettings(data.editToken)
        toast({
          title: "M-Pesa settings unlocked",
          description: "You can edit for 15 minutes. Settings will lock again automatically.",
        })
      }

      if (pendingOtpAction === 'register_integration_phone') {
        const settingsRes = await fetch('/api/catha/settings')
        const settingsData = await settingsRes.json()
        if (settingsData.success && settingsData.settings?.notifications) {
          const n = settingsData.settings.notifications
          setMpesaIntegrationConfigured(!!n.mpesaIntegrationPhoneConfigured)
          setMpesaIntegrationMasked(n.mpesaIntegrationPhoneMasked || null)
        }
        setMpesaIntegrationPhoneInput("")
        toast({ title: "Integration number saved", description: "The number is stored securely and cannot be viewed." })
      }

      if (pendingOtpAction === 'change_integration_phone_step1' && data.changeToken) {
        setMpesaChangeToken(data.changeToken)
        setMpesaChangeStep(2)
        toast({
          title: "Step 1 complete",
          description: "Enter the new number and verify OTP sent to it.",
        })
      }

      if (pendingOtpAction === 'change_integration_phone_step2') {
        const settingsRes = await fetch('/api/catha/settings')
        const settingsData = await settingsRes.json()
        if (settingsData.success && settingsData.settings?.notifications) {
          const n = settingsData.settings.notifications
          setMpesaIntegrationConfigured(!!n.mpesaIntegrationPhoneConfigured)
          setMpesaIntegrationMasked(n.mpesaIntegrationPhoneMasked || null)
        }
        setMpesaChangeStep(0)
        setMpesaChangeToken(null)
        setMpesaChangeNewPhoneInput("")
        toast({ title: "Integration number updated", description: "The new number is stored securely." })
      }

      setOtpDialogOpen(false)
      setOtpValue("")
      setPendingOtpAction(null)
      setPendingOtpNewPhone(undefined)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'OTP verification failed'
      toast({ title: "Verification failed", description: message, variant: "destructive" })
    } finally {
      setOtpVerifying(false)
    }
  }

  const startRegisterIntegrationPhone = async () => {
    const err = getPhoneValidationError(mpesaIntegrationPhoneInput)
    if (err) {
      toast({ title: "Invalid phone", description: err, variant: "destructive" })
      return
    }
    const normalized = normalizeKenyaPhone(mpesaIntegrationPhoneInput)
    if (!normalized) return
    const sent = await requestIntegrationOtp('register_integration_phone', normalized)
    if (sent) {
      openOtpDialog(
        'register_integration_phone',
        'Verify integration number',
        `Enter the 6-digit code sent to ${normalized.replace(/(\+254\d{3})\d{4}(\d{3})/, '$1****$2')}.`,
        normalized
      )
    }
  }

  const startChangeIntegrationPhoneStep1 = async () => {
    const sent = await requestIntegrationOtp('change_integration_phone_step1')
    if (sent) {
      openOtpDialog(
        'change_integration_phone_step1',
        'Verify current integration number',
        `Enter the OTP sent to ${mpesaIntegrationMasked || 'your registered number'}.`
      )
    }
  }

  const startChangeIntegrationPhoneStep2 = async () => {
    const err = getPhoneValidationError(mpesaChangeNewPhoneInput)
    if (err) {
      toast({ title: "Invalid phone", description: err, variant: "destructive" })
      return
    }
    if (!mpesaChangeToken) {
      toast({ title: "Authorization required", description: "Complete step 1 first.", variant: "destructive" })
      return
    }
    const normalized = normalizeKenyaPhone(mpesaChangeNewPhoneInput)
    if (!normalized) return
    const sent = await requestIntegrationOtp('change_integration_phone_step2', normalized, mpesaChangeToken)
    if (sent) {
      openOtpDialog(
        'change_integration_phone_step2',
        'Verify new integration number',
        `Enter the OTP sent to the new number ending ${normalized.slice(-3)}.`,
        normalized
      )
    }
  }

  const startUnlockMpesaEdit = async () => {
    if (!mpesaIntegrationConfigured) {
      toast({
        title: "Integration number required",
        description: "Add an M-Pesa integration number in Notifications before editing gateway settings.",
        variant: "destructive",
      })
      return
    }
    const sent = await requestIntegrationOtp('unlock_mpesa_edit')
    if (sent) {
      openOtpDialog(
        'unlock_mpesa_edit',
        'Unlock M-Pesa settings',
        `Enter the OTP sent to ${mpesaIntegrationMasked || 'the integration number'}.`
      )
    }
  }

  const lockMpesaSettings = async () => {
    setMpesaEditUnlocked(false)
    setMpesaEditToken(null)
    setMpesaEditExpiresAt(null)
    try {
      const response = await fetch('/api/catha/settings')
      const data = await response.json()
      if (data.success && data.settings?.mpesa) {
        const mpesa = data.settings.mpesa
        setConsumerKey(mpesa.consumerKey || "")
        setConsumerSecret(mpesa.consumerSecret || "")
        setPasskey(mpesa.passkey || "")
        setShortcode(mpesa.shortcode || "")
        setConfirmationUrl(mpesa.confirmationUrl || "")
        setValidationUrl(mpesa.validationUrl || "")
        setCallbackUrl(mpesa.callbackUrl || "")
        setMpesaEnabled(!!mpesa.enabled)
        setMpesaEnvironment(mpesa.environment === 'production' ? 'production' : 'sandbox')
      }
    } catch {
      setConsumerSecret("********")
      setPasskey("********")
    }
    toast({ title: "M-Pesa settings locked", description: "Sensitive fields are hidden again." })
  }

  const fetchAuthHealth = useCallback(async (daysOverride?: string) => {
    const days = daysOverride ?? authHealthDays
    setAuthHealthLoading(true)
    setAuthHealthError("")
    try {
      const response = await fetch(`/api/admin/auth-health?days=${encodeURIComponent(days)}`, {
        cache: "no-store",
      })
      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to load auth health")
      }
      setAuthHealth(data)
    } catch (error: any) {
      setAuthHealthError(error.message || "Failed to load auth health")
    } finally {
      setAuthHealthLoading(false)
    }
  }, [authHealthDays])

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [settingsRes, shiftSettingsRes] = await Promise.all([
          fetch('/api/catha/settings'),
          fetch('/api/catha/shift-settings'),
        ])
        const data = await settingsRes.json()
        const shiftSettingsData = await shiftSettingsRes.json().catch(() => null)
        
        if (data.success && data.settings) {
          const settings = data.settings
          
          // Business Info
          if (settings.businessInfo) {
            setBusinessName(settings.businessInfo.businessName || "Catha Lounge")
            setPhone(settings.businessInfo.phone || "+254 712 345678")
            setAddress(settings.businessInfo.address || "Westlands, Nairobi, Kenya")
            setCurrency(settings.businessInfo.currency || "kes")
            setVatRate(settings.businessInfo.vatRate || 16)
          }
          
          // Receipt Settings
          if (settings.receipt) {
            setAutoPrint(settings.receipt.autoPrint ?? true)
            setIncludeVatBreakdown(settings.receipt.includeVatBreakdown ?? true)
            setFooterMessage(settings.receipt.footerMessage || "Thank you for visiting!")
          }
          
          // Notifications
          if (settings.notifications) {
            setLowStockAlerts(settings.notifications.lowStockAlerts ?? true)
            setDailySalesSummary(settings.notifications.dailySalesSummary ?? true)
            setNewOrderNotifications(settings.notifications.newOrderNotifications ?? false)
            setSupplierDeliveryReminders(settings.notifications.supplierDeliveryReminders ?? true)
            setSecuritySmsAlertsEnabled(!!settings.notifications.securitySmsAlertsEnabled)
            setSecurityAlertNumbersText(
              Array.isArray(settings.notifications.securityAlertNumbers)
                ? settings.notifications.securityAlertNumbers.join(", ")
                : ""
            )
            setShiftNotificationPhonesText(
              Array.isArray(settings.notifications.shiftNotificationPhones)
                ? settings.notifications.shiftNotificationPhones.join(", ")
                : ""
            )
            setOnlineOrderSmsPhonesText(
              Array.isArray(settings.notifications.onlineOrderSmsPhones)
                ? settings.notifications.onlineOrderSmsPhones.join(", ")
                : ""
            )
            const threshold = Number(settings.notifications.securityDeniedBurstThreshold)
            setSecurityDeniedBurstThreshold(Number.isFinite(threshold) ? Math.max(3, Math.min(100, Math.round(threshold))) : 10)
            setManualMpesaApprovalSmsEnabled(!!settings.notifications.manualMpesaApprovalSmsEnabled)
            setManualMpesaApprovalPhonesText(
              Array.isArray(settings.notifications.manualMpesaApprovalPhones)
                ? settings.notifications.manualMpesaApprovalPhones.join(", ")
                : ""
            )
            const linkMins = Number(settings.notifications.manualMpesaApprovalLinkExpiryMinutes)
            setManualMpesaApprovalLinkExpiryMinutes(
              Number.isFinite(linkMins) ? Math.max(15, Math.min(24 * 60, Math.round(linkMins))) : 60
            )
            setMpesaIntegrationConfigured(!!settings.notifications.mpesaIntegrationPhoneConfigured)
            setMpesaIntegrationMasked(settings.notifications.mpesaIntegrationPhoneMasked || null)
          }
          
          // Security
          if (settings.security) {
            setRequirePinForVoids(settings.security.requirePinForVoids ?? true)
            setAutoLogout(settings.security.autoLogout || "15")
            setTwoFactorAuth(settings.security.twoFactorAuth ?? false)
          }
          
          // eTIMS
          if (settings.etims) {
            setEtimsEnabled(settings.etims.enabled ?? false)
            setEtimsEnvironment(settings.etims.environment || 'sandbox')
            setTaxpayerPin(settings.etims.taxpayerPin || "")
            setBranchOfficeId(settings.etims.branchOfficeId || "")
            setCommunicationKey(settings.etims.communicationKey || "")
            setEquipmentInfo(settings.etims.equipmentInfo || "")
          }

          // M-Pesa
          if (settings.mpesa) {
            setMpesaEnabled(settings.mpesa.enabled ?? false)
            setMpesaEnvironment(settings.mpesa.environment || 'sandbox')
            setConsumerKey(settings.mpesa.consumerKey || "")
            setConsumerSecret(settings.mpesa.consumerSecret || "")
            setPasskey(settings.mpesa.passkey || "")
            setShortcode(settings.mpesa.shortcode || "")
            setConfirmationUrl(settings.mpesa.confirmationUrl || "")
            setValidationUrl(settings.mpesa.validationUrl || "")
            setCallbackUrl(settings.mpesa.callbackUrl || "")
          }

          // Delivery (e-commerce checkout)
          if (settings.delivery) {
            setPickupAddress(settings.delivery.pickupAddress || "Catha Lounge – Nairobi (exact address confirmed at order)")
            setPickupDirectionsUrl(settings.delivery.pickupDirectionsUrl || "")
            if (settings.delivery.options && settings.delivery.options.length > 0) {
              setDeliveryOptions(settings.delivery.options)
            }
          }

          const eoh = settings.ecommerceOpeningHours
          if (eoh) {
            setEoEnabled(!!eoh.enabled)
            setEoOpenTime(
              typeof eoh.openingTime === "string" ? eoh.openingTime : defaultEcommerceOpeningHours.openingTime
            )
            setEoCloseTime(
              typeof eoh.closingTime === "string" ? eoh.closingTime : defaultEcommerceOpeningHours.closingTime
            )
            if (Array.isArray(eoh.openDays) && eoh.openDays.length) {
              setEoOpenDays([...new Set(eoh.openDays.map((n: number) => Number(n)).filter((n) => n >= 0 && n <= 6))].sort((a, b) => a - b))
            } else {
              setEoOpenDays([...defaultEcommerceOpeningHours.openDays])
            }
            setEoCustomNotice(typeof eoh.customNotice === "string" ? eoh.customNotice : "")
            setEoBlockCheckout(!!eoh.blockCheckoutWhenClosed)
          } else {
            setEoOpenTime(defaultEcommerceOpeningHours.openingTime)
            setEoCloseTime(defaultEcommerceOpeningHours.closingTime)
            setEoOpenDays([...defaultEcommerceOpeningHours.openDays])
          }
        }

        if (shiftSettingsData?.ok && shiftSettingsData?.settings) {
          const reminderMin = Number(shiftSettingsData.settings.noShiftReminderMinutes)
          const hardMin = Number(shiftSettingsData.settings.noShiftHardAlertMinutes)
          const openAt = String(shiftSettingsData.settings.openingTime ?? "").trim()
          const closeAt = String(shiftSettingsData.settings.closingTime ?? "").trim()
          const graceHours = Number(shiftSettingsData.settings.autoCloseGraceHours)
          const continueWindow = Number(shiftSettingsData.settings.continuePromptWindowHours)
          if (/^\d{2}:\d{2}$/.test(openAt)) setShiftOpeningTime(openAt)
          if (/^\d{2}:\d{2}$/.test(closeAt)) setShiftClosingTime(closeAt)
          if (Number.isFinite(reminderMin)) setNoShiftReminderMinutes(Math.max(1, Math.round(reminderMin)))
          if (Number.isFinite(hardMin)) setNoShiftHardAlertMinutes(Math.max(2, Math.round(hardMin)))
          if (Number.isFinite(graceHours)) setAutoCloseGraceHours(Math.max(1, Math.round(graceHours)))
          if (Number.isFinite(continueWindow)) setContinuePromptWindowHours(Math.max(1, Math.round(continueWindow)))
        }
      } catch (error) {
        console.error('Error loading settings:', error)
        toast({
          title: "Error",
          description: "Failed to load settings",
          variant: "destructive",
        })
      } finally {
        setLoading(false)
      }
    }
    
    loadSettings()
  }, [toast])

  useEffect(() => {
    fetchAuthHealth()
  }, [fetchAuthHealth])

  useEffect(() => {
    fetch('/api/catha/settings/sms-logs?limit=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => setSmsMetrics(data?.metrics ?? null))
      .catch(() => {})
  }, [])

  const applySmsGatewaySettings = useCallback((settings: any) => {
    if (!settings) return
    setSmsGwUserId(String(settings.userId || ""))
    setSmsGwPassword(String(settings.password || ""))
    setSmsGwApiKey(String(settings.apiKey || ""))
    setSmsGwSenderId(String(settings.senderId || ""))
    setSmsGwApiUrl(String(settings.apiUrl || ""))
    setSmsGwMsgType(String(settings.msgType || "text"))
    setSmsGwAdminOtpPhones(String(settings.adminOtpPhones || ""))
    setSmsGwConfigured(Boolean(settings.configured))
    setSmsGwPasswordConfigured(Boolean(settings.passwordConfigured))
    setSmsGwApiKeyConfigured(Boolean(settings.apiKeyConfigured))
    setSmsGwEnvFallback(settings.usingEnvFallback || {})
  }, [])

  const loadSmsGateway = useCallback(async () => {
    setSmsGwLoading(true)
    try {
      const res = await fetch('/api/catha/settings/sms-gateway', { cache: 'no-store' })
      const data = await res.json()
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load SMS gateway')
      applySmsGatewaySettings(data.settings)
    } catch (error: any) {
      console.error(error)
      toast({
        title: "Error",
        description: error?.message || "Failed to load SMS gateway settings",
        variant: "destructive",
      })
    } finally {
      setSmsGwLoading(false)
    }
  }, [applySmsGatewaySettings, toast])

  useEffect(() => {
    void loadSmsGateway()
  }, [loadSmsGateway])

  const saveSmsGateway = async () => {
    setSmsGwSaving(true)
    try {
      const res = await fetch('/api/catha/settings/sms-gateway', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: smsGwUserId,
          password: smsGwPassword,
          apiKey: smsGwApiKey,
          senderId: smsGwSenderId,
          apiUrl: smsGwApiUrl,
          msgType: smsGwMsgType,
          adminOtpPhones: smsGwAdminOtpPhones,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to save')
      applySmsGatewaySettings(data.settings)
      toast({
        title: "Success",
        description: data.settings?.configured
          ? "SMS gateway saved and ready to send"
          : "SMS gateway saved — fill Sender ID plus User/Password or API Key (or keep env fallbacks)",
      })
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to save SMS gateway",
        variant: "destructive",
      })
    } finally {
      setSmsGwSaving(false)
    }
  }

  const testSmsGateway = async () => {
    const phoneErr = getPhoneValidationError(smsGwTestPhone)
    if (phoneErr) {
      toast({ title: "Invalid phone", description: phoneErr, variant: "destructive" })
      return
    }
    setSmsGwTesting(true)
    try {
      const res = await fetch('/api/catha/settings/sms-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          phone: normalizeKenyaPhone(smsGwTestPhone) || smsGwTestPhone,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Test SMS failed')
      toast({
        title: "Test SMS sent",
        description: `Sent to ${data.phone}`,
      })
    } catch (error: any) {
      toast({
        title: "Test failed",
        description: error?.message || "Could not send test SMS",
        variant: "destructive",
      })
    } finally {
      setSmsGwTesting(false)
    }
  }

  const saveBusinessInfo = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessInfo: {
            businessName,
            phone,
            address,
            currency,
            vatRate: Number(vatRate),
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Business information saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving business info:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save business information",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveReceiptSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt: {
            autoPrint,
            includeVatBreakdown,
            footerMessage,
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Receipt settings saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving receipt settings:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save receipt settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveNotifications = async () => {
    const onlineOrderPhonesRaw = onlineOrderSmsPhonesText
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
    const normalizedOnlineOrderPhones = onlineOrderPhonesRaw
      .map((n) => normalizeKenyaPhone(n))
      .filter((n): n is string => Boolean(n))
    if (onlineOrderPhonesRaw.length !== normalizedOnlineOrderPhones.length) {
      toast({
        title: "Validation error",
        description: "Online order SMS numbers must be valid Kenyan numbers in +254 format.",
        variant: "destructive",
      })
      return
    }
    const manualApprovalPhonesRaw = manualMpesaApprovalPhonesText
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
    const normalizedManualApprovalPhones = normalizePhoneNumbers(manualApprovalPhonesRaw)
    if (
      manualMpesaApprovalSmsEnabled &&
      manualApprovalPhonesRaw.length > 0 &&
      normalizedManualApprovalPhones.length !== manualApprovalPhonesRaw.length
    ) {
      toast({
        title: "Validation error",
        description: "Manual M-Pesa approval numbers must be valid Kenyan numbers in +254 format.",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notifications: {
            lowStockAlerts,
            dailySalesSummary,
            newOrderNotifications,
            supplierDeliveryReminders,
            securitySmsAlertsEnabled,
            securityAlertNumbers: securityAlertNumbersText
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean),
            shiftNotificationPhones: shiftNotificationPhonesText
              .split(",")
              .map((n) => n.trim())
              .filter(Boolean),
            onlineOrderSmsPhones: normalizedOnlineOrderPhones,
            securityDeniedBurstThreshold: Math.max(3, Math.min(100, Math.round(Number(securityDeniedBurstThreshold) || 10))),
            manualMpesaApprovalSmsEnabled,
            manualMpesaApprovalPhones: normalizedManualApprovalPhones,
            manualMpesaApprovalLinkExpiryMinutes: Math.max(
              15,
              Math.min(24 * 60, Math.round(Number(manualMpesaApprovalLinkExpiryMinutes) || 60))
            ),
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Notification preferences saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving notifications:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save notification preferences",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveSecurity = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          security: {
            requirePinForVoids,
            autoLogout,
            twoFactorAuth,
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "Security settings saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving security settings:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save security settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveShiftReminderSettings = async () => {
    const reminder = Math.max(1, Math.round(Number(noShiftReminderMinutes) || 0))
    const hardAlert = Math.max(2, Math.round(Number(noShiftHardAlertMinutes) || 0))
    const graceHours = Math.max(1, Math.round(Number(autoCloseGraceHours) || 0))
    const continueWindow = Math.max(1, Math.round(Number(continuePromptWindowHours) || 0))
    const openingTime = shiftOpeningTime.trim()
    const closingTime = shiftClosingTime.trim()
    const hmRegex = /^([01]\d|2[0-3]):([0-5]\d)$/
    if (!hmRegex.test(openingTime) || !hmRegex.test(closingTime)) {
      toast({
        title: "Validation error",
        description: "Shift opening/closing time must be in 24-hour HH:mm format.",
        variant: "destructive",
      })
      return
    }
    if (hardAlert <= reminder) {
      toast({
        title: "Validation error",
        description: "Hard alert minutes must be greater than reminder minutes",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    try {
      const response = await fetch('/api/catha/shift-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          openingTime,
          closingTime,
          noShiftReminderMinutes: reminder,
          noShiftHardAlertMinutes: hardAlert,
          autoCloseGraceHours: graceHours,
          continuePromptWindowHours: continueWindow,
        }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save shift reminders')
      }
      setNoShiftReminderMinutes(reminder)
      setNoShiftHardAlertMinutes(hardAlert)
      setAutoCloseGraceHours(graceHours)
      setContinuePromptWindowHours(continueWindow)
      toast({
        title: "Success",
        description: "Shift timing and reminder settings saved successfully",
      })
    } catch (error: any) {
      console.error('Error saving shift reminder settings:', error)
      toast({
        title: "Error",
        description: error?.message || "Failed to save shift reminder settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const registerC2BUrls = async () => {
    if (!mpesaEditUnlocked || !mpesaEditToken) {
      toast({
        title: "Settings locked",
        description: "Verify OTP on the integration number before registering C2B URLs.",
        variant: "destructive",
      })
      return
    }

    setRegisteringUrls(true)
    try {
      // Validate required fields
      if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
        toast({
          title: "Validation Error",
          description: "Consumer Key, Consumer Secret, Passkey, and Shortcode are required to register URLs",
          variant: "destructive",
        })
        setRegisteringUrls(false)
        return
      }

      // Ensure settings are saved first
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin
      const defaultCallbackUrl = `${baseUrl}/api/mpesa/callback`
      const defaultValidationUrl = `${baseUrl}/api/c2b/validation`
      const defaultConfirmationUrl = `${baseUrl}/api/c2b/confirmation`

      // Save settings first if not already saved
      const saveResponse = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(mpesaEditToken ? { 'x-mpesa-edit-token': mpesaEditToken } : {}),
        },
        body: JSON.stringify({
          mpesa: {
            enabled: mpesaEnabled,
            environment: mpesaEnvironment,
            consumerKey,
            consumerSecret,
            passkey,
            shortcode,
            confirmationUrl: confirmationUrl || defaultConfirmationUrl,
            validationUrl: validationUrl || defaultValidationUrl,
            callbackUrl: callbackUrl || defaultCallbackUrl,
          },
        }),
      })

      const saveData = await saveResponse.json()
      if (!saveData.success) {
        throw new Error('Failed to save settings before registering URLs')
      }

      // Register C2B URLs
      const registerResponse = await fetch('/api/mpesa/register-urls', {
        method: 'POST',
        headers: mpesaEditToken ? { 'x-mpesa-edit-token': mpesaEditToken } : {},
      })
      
      const registerData = await registerResponse.json()
      
      if (registerData.success) {
        toast({
          title: "URLs Registered Successfully",
          description: "C2B Validation and Confirmation URLs have been registered with M-Pesa",
        })
      } else {
        throw new Error(registerData.error || 'Failed to register URLs')
      }
    } catch (error: any) {
      console.error('Error registering C2B URLs:', error)
      toast({
        title: "Registration Failed",
        description: error.message || "Failed to register C2B URLs. Please check your credentials and try again.",
        variant: "destructive",
      })
    } finally {
      setRegisteringUrls(false)
    }
  }

  const saveMpesa = async () => {
    if (!mpesaEditUnlocked || !mpesaEditToken) {
      toast({
        title: "Settings locked",
        description: "Verify OTP on the integration number to edit M-Pesa settings.",
        variant: "destructive",
      })
      return
    }

    setSaving(true)
    try {
      // Validate required fields if enabled
      if (mpesaEnabled) {
        if (!consumerKey || !consumerSecret || !passkey || !shortcode) {
          toast({
            title: "Validation Error",
            description: "Consumer Key, Consumer Secret, Passkey, and Shortcode are required when M-Pesa is enabled",
            variant: "destructive",
          })
          setSaving(false)
          return
        }
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || window.location.origin
      const defaultCallbackUrl = `${baseUrl}/api/mpesa/callback`
      const defaultValidationUrl = `${baseUrl}/api/c2b/validation`
      const defaultConfirmationUrl = `${baseUrl}/api/c2b/confirmation`

      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-mpesa-edit-token': mpesaEditToken,
        },
        body: JSON.stringify({
          mpesa: {
            enabled: mpesaEnabled,
            environment: mpesaEnvironment,
            consumerKey,
            consumerSecret,
            passkey,
            shortcode,
            confirmationUrl: confirmationUrl || defaultConfirmationUrl,
            validationUrl: validationUrl || defaultValidationUrl,
            callbackUrl: callbackUrl || defaultCallbackUrl,
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "M-Pesa settings saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving M-Pesa settings:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save M-Pesa settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveEtims = async () => {
    setSaving(true)
    try {
      // Validate required fields if enabled
      if (etimsEnabled) {
        if (!taxpayerPin || !branchOfficeId) {
          toast({
            title: "Validation Error",
            description: "Taxpayer PIN and Branch Office ID are required when eTIMS is enabled",
            variant: "destructive",
          })
          setSaving(false)
          return
        }
      }

      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          etims: {
            enabled: etimsEnabled,
            environment: etimsEnvironment,
            taxpayerPin,
            branchOfficeId,
            communicationKey,
            equipmentInfo,
          },
        }),
      })
      
      const data = await response.json()
      
      if (data.success) {
        toast({
          title: "Success",
          description: "eTIMS settings saved successfully",
        })
      } else {
        throw new Error(data.error || 'Failed to save')
      }
    } catch (error: any) {
      console.error('Error saving eTIMS settings:', error)
      toast({
        title: "Error",
        description: error.message || "Failed to save eTIMS settings",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const saveDelivery = async () => {
    setSaving(true)
    try {
      const cleanedOptions: DeliveryOption[] = deliveryOptions.map((opt, index) => {
        const value = opt.value.trim() || `custom_option_${index + 1}`
        return {
          value,
          label: opt.label.trim() || "Untitled option",
          fee: Number.isFinite(opt.fee) ? Math.max(0, Number(opt.fee)) : 0,
          subtext: opt.subtext.trim(),
          enabled: !!opt.enabled,
        }
      })
      const response = await fetch('/api/catha/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delivery: {
            pickupAddress: pickupAddress.trim() || "Catha Lounge – Nairobi (exact address confirmed at order)",
            pickupDirectionsUrl: pickupDirectionsUrl.trim() || undefined,
            options: cleanedOptions,
          },
        }),
      })
      const data = await response.json()
      if (data.success) {
        sonnerToast.success("Saved")
      } else {
        sonnerToast.error("Failed to save delivery settings")
      }
    } catch (error: any) {
      console.error('Error saving delivery settings:', error)
      sonnerToast.error("Failed to save delivery settings")
    } finally {
      setSaving(false)
    }
  }

  const saveEcommerceOpeningHours = async () => {
    const payload = {
      enabled: eoEnabled,
      openingTime: eoOpenTime.trim(),
      closingTime: eoCloseTime.trim(),
      openDays: eoOpenDays,
      customNotice: eoCustomNotice.trim(),
      blockCheckoutWhenClosed: eoBlockCheckout,
    }
    const validated = validateEcommerceOpeningHoursPayload(payload)
    if (!validated.ok) {
      sonnerToast.error(validated.error)
      return
    }
    setSaving(true)
    try {
      const response = await fetch("/api/catha/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ecommerceOpeningHours: validated.value }),
      })
      const data = await response.json()
      if (data.success) {
        sonnerToast.success("E-commerce opening hours saved")
      } else {
        sonnerToast.error(typeof data.error === "string" ? data.error : "Failed to save")
      }
    } catch (e) {
      console.error(e)
      sonnerToast.error("Failed to save e-commerce opening hours")
    } finally {
      setSaving(false)
    }
  }

  const addDeliveryOption = () => {
    const next = deliveryOptions.length + 1
    setDeliveryOptions((prev) => [
      ...prev,
      {
        value: `custom_option_${next}`,
        label: "New Delivery Option",
        fee: 0,
        subtext: "Custom delivery option",
        enabled: true,
      },
    ])
  }

  const authDailyRows = useMemo(() => {
    if (!authHealth?.daily?.length) return []
    const map = new Map<string, { day: string; start: number; success: number; timeout: number }>()
    authHealth.daily.forEach((row) => {
      if (!map.has(row.day)) {
        map.set(row.day, { day: row.day, start: 0, success: 0, timeout: 0 })
      }
      const current = map.get(row.day)!
      if (row.type === "start") current.start = row.count
      if (row.type === "success") current.success = row.count
      if (row.type === "session_wait_timeout") current.timeout = row.count
    })
    return Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day))
  }, [authHealth])

  const authDailyMax = useMemo(
    () => Math.max(1, ...authDailyRows.map((r) => Math.max(r.start, r.success, r.timeout))),
    [authDailyRows]
  )

  if (loading) {
    return (
      <>
        <Header title="Settings" subtitle="Manage your POS system" />
        <div className="p-6">
          <div className="text-center py-12">Loading settings...</div>
        </div>
      </>
    )
  }

  return (
    <>
        <Header title="Settings" subtitle="Manage your POS system" />
        <div className="p-6">
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/catha/settings/sms-logs">Open SMS Logs</Link>
              </Button>
              {smsMetrics ? (
                <>
                  <Badge variant="outline">SMS: {smsMetrics.total}</Badge>
                  <Badge variant="outline">Success: {smsMetrics.successRate}%</Badge>
                  <Badge variant="outline">Failure: {smsMetrics.failureRate}%</Badge>
                  <Badge variant="outline">Pending: {smsMetrics.pending}</Badge>
                  <Badge variant="destructive">Critical: {smsMetrics.unresolvedCriticalAlerts}</Badge>
                </>
              ) : null}
            </div>
          </div>
          <Tabs defaultValue="general" className="space-y-6">
            <TabsList className="bg-secondary">
              <TabsTrigger value="general" className="gap-2">
                <Building className="h-4 w-4" />
                General
              </TabsTrigger>
              <TabsTrigger value="users" className="gap-2">
                <Users className="h-4 w-4" />
                Users
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="security" className="gap-2">
                <Shield className="h-4 w-4" />
                Security
              </TabsTrigger>
              <TabsTrigger value="etims" className="gap-2">
                <Receipt className="h-4 w-4" />
                eTIMS
              </TabsTrigger>
              <TabsTrigger value="mpesa" className="gap-2">
                <Smartphone className="h-4 w-4" />
                M-Pesa
              </TabsTrigger>
              <TabsTrigger value="sms-gateway" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                SMS
              </TabsTrigger>
              <TabsTrigger value="delivery" className="gap-2">
                <Truck className="h-4 w-4" />
                Delivery
              </TabsTrigger>
              <TabsTrigger value="ecommerce-hours" className="gap-2">
                <Clock className="h-4 w-4" />
                Opening hours
              </TabsTrigger>
              <TabsTrigger value="auth-health" className="gap-2">
                <Activity className="h-4 w-4" />
                Auth health
              </TabsTrigger>
            </TabsList>

            <TabsContent value="general" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">Business Information</CardTitle>
                  <CardDescription>Update your bar's details</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="businessName">Business Name</Label>
                      <Input 
                        id="businessName" 
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input 
                        id="phone" 
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="address">Address</Label>
                    <Input 
                      id="address" 
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency</Label>
                      <Select value={currency} onValueChange={setCurrency}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kes">KES (Ksh)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vat">VAT Rate (%)</Label>
                      <Input 
                        id="vat" 
                        type="number" 
                        value={vatRate}
                        onChange={(e) => setVatRate(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <Button onClick={saveBusinessInfo} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-card-foreground">
                    <Printer className="h-5 w-5" />
                    Receipt Settings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-print receipts</Label>
                      <p className="text-sm text-muted-foreground">Print receipt after each sale</p>
                    </div>
                    <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Include VAT breakdown</Label>
                      <p className="text-sm text-muted-foreground">Show VAT details on receipt</p>
                    </div>
                    <Switch checked={includeVatBreakdown} onCheckedChange={setIncludeVatBreakdown} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Receipt footer message</Label>
                      <p className="text-sm text-muted-foreground">Custom message at bottom</p>
                    </div>
                    <Input 
                      className="w-64" 
                      value={footerMessage}
                      onChange={(e) => setFooterMessage(e.target.value)}
                    />
                  </div>
                  <Button onClick={saveReceiptSettings} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="users" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-card-foreground">User Management</CardTitle>
                    <CardDescription>Manage staff accounts and permissions</CardDescription>
                  </div>
                  <Button>Add User</Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {staff.map((member) => (
                      <div
                        key={member.id}
                        className="flex items-center justify-between rounded-lg border border-border p-4"
                      >
                        <div className="flex items-center gap-4">
                          <Avatar className="h-12 w-12 border border-border">
                            <AvatarImage src={member.avatar || "/placeholder.svg"} />
                            <AvatarFallback className="bg-primary/20 text-primary">
                              {member.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium text-card-foreground">{member.name}</p>
                            <p className="text-sm text-muted-foreground capitalize">{member.role}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge variant={member.role === "admin" ? "default" : "outline"}>{member.role}</Badge>
                          <Button variant="outline" size="sm">
                            Edit
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notifications" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">Notification Preferences</CardTitle>
                  <CardDescription>Configure how you receive alerts</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Low stock alerts</Label>
                      <p className="text-sm text-muted-foreground">Get notified when items are running low</p>
                    </div>
                    <Switch checked={lowStockAlerts} onCheckedChange={setLowStockAlerts} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Daily sales summary</Label>
                      <p className="text-sm text-muted-foreground">Receive end-of-day sales report</p>
                    </div>
                    <Switch checked={dailySalesSummary} onCheckedChange={setDailySalesSummary} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>New order notifications</Label>
                      <p className="text-sm text-muted-foreground">Sound alert for new orders</p>
                    </div>
                    <Switch checked={newOrderNotifications} onCheckedChange={setNewOrderNotifications} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Supplier delivery reminders</Label>
                      <p className="text-sm text-muted-foreground">Remind about scheduled deliveries</p>
                    </div>
                    <Switch checked={supplierDeliveryReminders} onCheckedChange={setSupplierDeliveryReminders} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Security SMS alerts</Label>
                      <p className="text-sm text-muted-foreground">Send SMS when denied-action spikes are detected.</p>
                    </div>
                    <Switch checked={securitySmsAlertsEnabled} onCheckedChange={setSecuritySmsAlertsEnabled} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="security-alert-numbers">Security alert numbers</Label>
                    <Input
                      id="security-alert-numbers"
                      value={securityAlertNumbersText}
                      onChange={(e) => setSecurityAlertNumbersText(e.target.value)}
                      placeholder="+254712345678, +254700000000"
                    />
                    <p className="text-xs text-muted-foreground">Comma-separated phone numbers.</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="security-alert-threshold">Denied burst threshold (5-minute window)</Label>
                    <Input
                      id="security-alert-threshold"
                      type="number"
                      min={3}
                      max={100}
                      value={securityDeniedBurstThreshold}
                      onChange={(e) => setSecurityDeniedBurstThreshold(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="shift-notification-phones">Shift Notification Numbers</Label>
                    <Input
                      id="shift-notification-phones"
                      value={shiftNotificationPhonesText}
                      onChange={(e) => setShiftNotificationPhonesText(e.target.value)}
                      placeholder="+254712345678, +254700000000"
                    />
                    <p className="text-xs text-muted-foreground">
                      Receives shift open/close SMS with timing summary.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="online-order-sms-phones">Online Order SMS Numbers</Label>
                    <Input
                      id="online-order-sms-phones"
                      value={onlineOrderSmsPhonesText}
                      onChange={(e) => setOnlineOrderSmsPhonesText(e.target.value)}
                      placeholder="+254712345678, +254700000000"
                    />
                    <p className="text-xs text-muted-foreground">
                      Receives SMS alerts when new online orders are placed. Use comma-separated +254 numbers.
                    </p>
                  </div>
                  <Separator />
                  <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 space-y-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                      <div>
                        <Label className="text-amber-900">M-Pesa integration number</Label>
                        <p className="text-sm text-amber-800 mt-1">
                          Secured phone for OTP when editing M-Pesa gateway credentials. The full number is never shown after it is saved.
                        </p>
                      </div>
                    </div>
                    {mpesaIntegrationConfigured ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                          <Lock className="h-4 w-4 text-muted-foreground" />
                          <span className="font-mono">{mpesaIntegrationMasked || "********"}</span>
                          <Badge variant="secondary">Configured</Badge>
                        </div>
                        {mpesaChangeStep === 0 ? (
                          <Button type="button" variant="outline" size="sm" onClick={() => { setMpesaChangeStep(1); setMpesaChangeNewPhoneInput("") }}>
                            Change integration number
                          </Button>
                        ) : mpesaChangeStep === 1 ? (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Step 1: Verify OTP sent to the current integration number.
                            </p>
                            <Button type="button" size="sm" onClick={startChangeIntegrationPhoneStep1} disabled={otpSending}>
                              {otpSending ? "Sending..." : "Send OTP to current number"}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setMpesaChangeStep(0)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Step 2: Enter the new number and verify OTP sent to it.
                            </p>
                            <Input
                              value={mpesaChangeNewPhoneInput}
                              onChange={(e) => setMpesaChangeNewPhoneInput(e.target.value)}
                              placeholder="07XXXXXXXX or +2547XXXXXXXX"
                            />
                            <div className="flex gap-2">
                              <Button type="button" size="sm" onClick={startChangeIntegrationPhoneStep2} disabled={otpSending}>
                                {otpSending ? "Sending..." : "Send OTP to new number"}
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => { setMpesaChangeStep(0); setMpesaChangeToken(null) }}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          value={mpesaIntegrationPhoneInput}
                          onChange={(e) => setMpesaIntegrationPhoneInput(e.target.value)}
                          placeholder="07XXXXXXXX or +2547XXXXXXXX"
                        />
                        <Button type="button" size="sm" onClick={startRegisterIntegrationPhone} disabled={otpSending}>
                          {otpSending ? "Sending OTP..." : "Verify & save integration number"}
                        </Button>
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Manual M-Pesa approval SMS</Label>
                      <p className="text-sm text-muted-foreground">
                        Send managers a one-time approval link when staff submit a manual M-Pesa recovery entry.
                      </p>
                    </div>
                    <Switch
                      checked={manualMpesaApprovalSmsEnabled}
                      onCheckedChange={setManualMpesaApprovalSmsEnabled}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-mpesa-approval-phones">Manual M-Pesa approval numbers</Label>
                    <Input
                      id="manual-mpesa-approval-phones"
                      value={manualMpesaApprovalPhonesText}
                      onChange={(e) => setManualMpesaApprovalPhonesText(e.target.value)}
                      placeholder="+254712345678, +254700000000"
                    />
                    <p className="text-xs text-muted-foreground">
                      Managers receive an SMS with a secure one-time link to approve or reject pending manual payments.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="manual-mpesa-approval-expiry">Approval link expiry (minutes)</Label>
                    <Input
                      id="manual-mpesa-approval-expiry"
                      type="number"
                      min={15}
                      max={1440}
                      value={manualMpesaApprovalLinkExpiryMinutes}
                      onChange={(e) => setManualMpesaApprovalLinkExpiryMinutes(Number(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Default 60 minutes. Link can only be used once.
                    </p>
                  </div>
                  <Button onClick={saveNotifications} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">Security Settings</CardTitle>
                  <CardDescription>Protect your POS system</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Require PIN for voids</Label>
                      <p className="text-sm text-muted-foreground">Manager PIN required to void transactions</p>
                    </div>
                    <Switch checked={requirePinForVoids} onCheckedChange={setRequirePinForVoids} />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-logout</Label>
                      <p className="text-sm text-muted-foreground">Logout after inactivity</p>
                    </div>
                    <Select value={autoLogout} onValueChange={setAutoLogout}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5">5 minutes</SelectItem>
                        <SelectItem value="15">15 minutes</SelectItem>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="never">Never</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Two-factor authentication</Label>
                      <p className="text-sm text-muted-foreground">Extra security for admin accounts</p>
                    </div>
                    <Switch checked={twoFactorAuth} onCheckedChange={setTwoFactorAuth} />
                  </div>
                  <Separator />
                  <div className="space-y-3 rounded-lg border border-border p-4">
                    <div>
                      <Label>Shift timing and reminders</Label>
                      <p className="text-sm text-muted-foreground">
                        Set workforce clock-in schedule and reminder thresholds.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="shift-opening-time">Shift opening time (24h HH:mm)</Label>
                        <Input
                          id="shift-opening-time"
                          type="time"
                          value={shiftOpeningTime}
                          onChange={(e) => setShiftOpeningTime(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="shift-closing-time">Shift closing time (24h HH:mm)</Label>
                        <Input
                          id="shift-closing-time"
                          type="time"
                          value={shiftClosingTime}
                          onChange={(e) => setShiftClosingTime(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="no-shift-reminder-min">Reminder interval (minutes)</Label>
                        <Input
                          id="no-shift-reminder-min"
                          type="number"
                          min={1}
                          value={noShiftReminderMinutes}
                          onChange={(e) => setNoShiftReminderMinutes(Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="no-shift-hard-min">Hard alert after (minutes)</Label>
                        <Input
                          id="no-shift-hard-min"
                          type="number"
                          min={2}
                          value={noShiftHardAlertMinutes}
                          onChange={(e) => setNoShiftHardAlertMinutes(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="auto-close-grace-hours">Auto-close grace after shift end (hours)</Label>
                        <Input
                          id="auto-close-grace-hours"
                          type="number"
                          min={1}
                          max={12}
                          value={autoCloseGraceHours}
                          onChange={(e) => setAutoCloseGraceHours(Number(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="continue-prompt-window-hours">Continue-shift prompt window (hours)</Label>
                        <Input
                          id="continue-prompt-window-hours"
                          type="number"
                          min={1}
                          max={168}
                          value={continuePromptWindowHours}
                          onChange={(e) => setContinuePromptWindowHours(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <Button onClick={saveShiftReminderSettings} disabled={saving}>
                      {saving ? "Saving..." : "Save Shift Timing"}
                    </Button>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Change Admin Password</Label>
                    <div className="flex gap-3">
                      <Input type="password" placeholder="Current password" className="flex-1" />
                      <Input type="password" placeholder="New password" className="flex-1" />
                      <Button variant="outline">Update</Button>
                    </div>
                  </div>
                  <Button onClick={saveSecurity} disabled={saving}>
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="etims" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">KRA eTIMS OSCU Configuration</CardTitle>
                  <CardDescription>
                    Configure your On-Site Communication Unit (OSCU) for KRA eTIMS integration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable eTIMS Integration</Label>
                      <p className="text-sm text-muted-foreground">Enable KRA eTIMS OSCU integration</p>
                    </div>
                    <Switch checked={etimsEnabled} onCheckedChange={setEtimsEnabled} />
                  </div>
                  <Separator />
                  
                  {etimsEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="etimsEnvironment">Environment</Label>
                        <Select value={etimsEnvironment} onValueChange={(value: 'sandbox' | 'production') => setEtimsEnvironment(value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                            <SelectItem value="production">Production</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {etimsEnvironment === 'sandbox' 
                            ? 'Sandbox URL: https://etims-api-sbx.kra.go.ke'
                            : 'Production URL: https://etims-api.kra.go.ke'}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="taxpayerPin">Taxpayer PIN *</Label>
                          <Input 
                            id="taxpayerPin" 
                            type="text"
                            value={taxpayerPin}
                            onChange={(e) => setTaxpayerPin(e.target.value)}
                            placeholder="Enter your KRA Taxpayer PIN"
                          />
                          <p className="text-xs text-muted-foreground">Required for OSCU initialization</p>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="branchOfficeId">Branch Office ID *</Label>
                          <Input 
                            id="branchOfficeId" 
                            type="text"
                            value={branchOfficeId}
                            onChange={(e) => setBranchOfficeId(e.target.value)}
                            placeholder="Enter Branch Office ID"
                          />
                          <p className="text-xs text-muted-foreground">Required for OSCU initialization</p>
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="communicationKey">Communication Key</Label>
                        <Input 
                          id="communicationKey" 
                          type="password"
                          value={communicationKey}
                          onChange={(e) => setCommunicationKey(e.target.value)}
                          placeholder="Retrieved from KRA after OSCU initialization"
                        />
                        <p className="text-xs text-muted-foreground">
                          This key is retrieved from KRA servers after successful OSCU initialization
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="equipmentInfo">Equipment Information</Label>
                        <Input 
                          id="equipmentInfo" 
                          type="text"
                          value={equipmentInfo}
                          onChange={(e) => setEquipmentInfo(e.target.value)}
                          placeholder="Optional: Equipment details for OSCU initialization"
                        />
                        <p className="text-xs text-muted-foreground">
                          Optional equipment information for OSCU device activation
                        </p>
                      </div>
                      
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                        <p className="text-sm font-semibold text-blue-900">OSCU Initialization Process:</p>
                        <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
                          <li>Enter your Taxpayer PIN and Branch Office ID</li>
                          <li>Click "Initialize OSCU" to activate the device</li>
                          <li>The Communication Key will be retrieved automatically from KRA servers</li>
                          <li>Save the settings to store the credentials securely</li>
                        </ol>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button 
                          onClick={saveEtims} 
                          disabled={saving}
                          className="flex-1"
                        >
                          {saving ? "Saving..." : "Save Settings"}
                        </Button>
                        <Button 
                          variant="outline"
                          onClick={async () => {
                            if (!taxpayerPin || !branchOfficeId) {
                              toast({
                                title: "Validation Error",
                                description: "Please enter Taxpayer PIN and Branch Office ID first",
                                variant: "destructive",
                              })
                              return
                            }
                            
                            try {
                              setSaving(true)
                              const response = await fetch('/api/catha/etims/initialize', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  taxpayerPin,
                                  branchOfficeId,
                                  equipmentInfo: equipmentInfo || undefined,
                                  environment: etimsEnvironment,
                                }),
                              })
                              
                              const data = await response.json()
                              
                              if (data.success) {
                                if (data.communicationKey) {
                                  setCommunicationKey(data.communicationKey)
                                  toast({
                                    title: "OSCU Initialized Successfully",
                                    description: "Communication Key retrieved and saved",
                                  })
                                } else {
                                  toast({
                                    title: "Initialization Started",
                                    description: data.message || "OSCU initialization process initiated",
                                  })
                                }
                              } else {
                                throw new Error(data.error || 'Failed to initialize OSCU')
                              }
                            } catch (error: any) {
                              console.error('Error initializing OSCU:', error)
                              toast({
                                title: "Initialization Failed",
                                description: error.message || "Failed to initialize OSCU. Please check your credentials.",
                                variant: "destructive",
                              })
                            } finally {
                              setSaving(false)
                            }
                          }}
                          disabled={saving || !taxpayerPin || !branchOfficeId}
                        >
                          Initialize OSCU
                        </Button>
                      </div>
                    </>
                  )}
                  
                  {!etimsEnabled && (
                    <div className="bg-muted/50 border border-border rounded-lg p-4">
                      <p className="text-sm text-muted-foreground">
                        Enable eTIMS integration to configure OSCU settings for KRA tax compliance.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="mpesa" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">M-Pesa Payment Gateway Configuration</CardTitle>
                  <CardDescription>
                    Configure M-Pesa STK Push and C2B payment integration
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className={`rounded-lg border p-4 ${mpesaFieldsLocked ? 'border-amber-200 bg-amber-50/80' : 'border-emerald-200 bg-emerald-50/80'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3">
                        {mpesaFieldsLocked ? (
                          <Lock className="h-5 w-5 text-amber-700 mt-0.5 shrink-0" />
                        ) : (
                          <ShieldCheck className="h-5 w-5 text-emerald-700 mt-0.5 shrink-0" />
                        )}
                        <div>
                          <p className={`text-sm font-semibold ${mpesaFieldsLocked ? 'text-amber-900' : 'text-emerald-900'}`}>
                            {mpesaFieldsLocked ? 'M-Pesa settings are locked' : 'M-Pesa settings unlocked'}
                          </p>
                          <p className={`text-xs mt-1 ${mpesaFieldsLocked ? 'text-amber-800' : 'text-emerald-800'}`}>
                            {mpesaFieldsLocked
                              ? 'OTP verification on the integration number is required to view or edit credentials.'
                              : mpesaEditExpiresAt
                                ? `Edit session expires at ${mpesaEditExpiresAt.toLocaleTimeString()}.`
                                : 'You can edit gateway settings.'}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {mpesaFieldsLocked ? (
                          <Button type="button" size="sm" onClick={startUnlockMpesaEdit} disabled={otpSending || !mpesaIntegrationConfigured}>
                            {otpSending ? "Sending OTP..." : "Unlock with OTP"}
                          </Button>
                        ) : (
                          <Button type="button" size="sm" variant="outline" onClick={lockMpesaSettings}>
                            Lock now
                          </Button>
                        )}
                      </div>
                    </div>
                    {!mpesaIntegrationConfigured && (
                      <p className="text-xs text-amber-800 mt-3">
                        Add an M-Pesa integration number in the Notifications tab first.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Enable M-Pesa Gateway</Label>
                      <p className="text-sm text-muted-foreground">Enable M-Pesa payment processing</p>
                    </div>
                    <Switch checked={mpesaEnabled} onCheckedChange={setMpesaEnabled} disabled={mpesaFieldsLocked} />
                  </div>
                  <Separator />
                  
                  {mpesaEnabled && (
                    <>
                      <div className="space-y-2">
                        <Label htmlFor="mpesaEnvironment">Environment</Label>
                        <Select value={mpesaEnvironment} onValueChange={(value: 'sandbox' | 'production') => setMpesaEnvironment(value)} disabled={mpesaFieldsLocked}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sandbox">Sandbox (Testing)</SelectItem>
                            <SelectItem value="production">Production</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {mpesaEnvironment === 'sandbox' 
                            ? 'Sandbox URL: https://sandbox.safaricom.co.ke'
                            : 'Production URL: https://api.safaricom.co.ke'}
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="consumerKey">Consumer Key *</Label>
                          <Input 
                            id="consumerKey" 
                            type="text"
                            value={consumerKey}
                            onChange={(e) => setConsumerKey(e.target.value)}
                            placeholder="Enter M-Pesa Consumer Key"
                            disabled={mpesaFieldsLocked}
                            readOnly={mpesaFieldsLocked}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="consumerSecret">Consumer Secret *</Label>
                          <Input 
                            id="consumerSecret" 
                            type="password"
                            value={consumerSecret}
                            onChange={(e) => setConsumerSecret(e.target.value)}
                            placeholder="Enter M-Pesa Consumer Secret"
                            disabled={mpesaFieldsLocked}
                            readOnly={mpesaFieldsLocked}
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="passkey">Passkey *</Label>
                          <Input 
                            id="passkey" 
                            type="password"
                            value={passkey}
                            onChange={(e) => setPasskey(e.target.value)}
                            placeholder="Enter M-Pesa Passkey"
                            disabled={mpesaFieldsLocked}
                            readOnly={mpesaFieldsLocked}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="shortcode">Shortcode (Paybill/Till) *</Label>
                          <Input 
                            id="shortcode" 
                            type="text"
                            value={shortcode}
                            onChange={(e) => setShortcode(e.target.value)}
                            placeholder="Enter Shortcode"
                            disabled={mpesaFieldsLocked}
                            readOnly={mpesaFieldsLocked}
                          />
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="callbackUrl">STK Push Callback URL</Label>
                        <Input 
                          id="callbackUrl" 
                          type="url"
                          value={callbackUrl}
                          onChange={(e) => setCallbackUrl(e.target.value)}
                          placeholder="https://yourdomain.com/api/mpesa/callback"
                          disabled={mpesaFieldsLocked}
                          readOnly={mpesaFieldsLocked}
                        />
                        <p className="text-xs text-muted-foreground">
                          URL where M-Pesa sends STK Push payment callbacks
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="validationUrl">C2B Validation URL</Label>
                        <Input 
                          id="validationUrl" 
                          type="url"
                          value={validationUrl}
                          onChange={(e) => setValidationUrl(e.target.value)}
                          placeholder="https://yourdomain.com/api/c2b/validation"
                          disabled={mpesaFieldsLocked}
                          readOnly={mpesaFieldsLocked}
                        />
                        <p className="text-xs text-muted-foreground">
                          URL where M-Pesa sends C2B validation requests
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="confirmationUrl">C2B Confirmation URL</Label>
                        <Input 
                          id="confirmationUrl" 
                          type="url"
                          value={confirmationUrl}
                          onChange={(e) => setConfirmationUrl(e.target.value)}
                          placeholder="https://yourdomain.com/api/c2b/confirmation"
                          disabled={mpesaFieldsLocked}
                          readOnly={mpesaFieldsLocked}
                        />
                        <p className="text-xs text-muted-foreground">
                          URL where M-Pesa sends C2B confirmation requests
                        </p>
                      </div>
                      
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
                        <p className="text-sm font-semibold text-blue-900">M-Pesa Integration Notes:</p>
                        <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                          <li>STK Push is used for customer-initiated payments from POS</li>
                          <li>C2B handles direct payments to your Paybill/Till number</li>
                          <li>Ensure your URLs are publicly accessible (not localhost in production)</li>
                          <li>Register C2B URLs after saving settings to activate C2B payments</li>
                        </ul>
                      </div>
                      
                      <div className="flex gap-3">
                        <Button 
                          onClick={saveMpesa} 
                          disabled={saving || mpesaFieldsLocked}
                          className="flex-1"
                        >
                          {saving ? "Saving..." : "Save M-Pesa Settings"}
                        </Button>
                        <Button 
                          onClick={registerC2BUrls} 
                          disabled={registeringUrls || saving || mpesaFieldsLocked || !mpesaEnabled || !consumerKey || !consumerSecret || !passkey || !shortcode}
                          variant="outline"
                          className="flex-1"
                        >
                          {registeringUrls ? (
                            <span className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Registering...
                            </span>
                          ) : (
                            "Register C2B URLs"
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                  
                  {!mpesaEnabled && (
                    <div className="bg-muted/50 border border-border rounded-lg p-4">
                      <p className="text-sm text-muted-foreground">
                        Enable M-Pesa integration to configure payment gateway settings.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sms-gateway" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground">SMS Gateway (Zettatel)</CardTitle>
                  <CardDescription>
                    Fill any field here to override the matching environment variable. Blank fields keep using env.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {smsGwLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading SMS gateway…
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={smsGwConfigured ? "default" : "destructive"}>
                          {smsGwConfigured ? "Ready to send" : "Not configured"}
                        </Badge>
                        {Object.entries(smsGwEnvFallback).some(([, v]) => v) ? (
                          <Badge variant="outline">Using env for some blank fields</Badge>
                        ) : null}
                        <Button type="button" variant="ghost" size="sm" onClick={() => void loadSmsGateway()}>
                          <RefreshCw className="h-3.5 w-3.5 mr-1" />
                          Refresh
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="sms-userid">
                            User ID {smsGwEnvFallback.userId ? <span className="text-xs text-muted-foreground">(env fallback)</span> : null}
                          </Label>
                          <Input
                            id="sms-userid"
                            value={smsGwUserId}
                            onChange={(e) => setSmsGwUserId(e.target.value)}
                            placeholder="Zettatel userid"
                            autoComplete="off"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sms-sender">
                            Sender ID {smsGwEnvFallback.senderId ? <span className="text-xs text-muted-foreground">(env fallback)</span> : null}
                          </Label>
                          <Input
                            id="sms-sender"
                            value={smsGwSenderId}
                            onChange={(e) => setSmsGwSenderId(e.target.value)}
                            placeholder="Approved sender name"
                            autoComplete="off"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sms-password">
                            Password {smsGwPasswordConfigured && !smsGwPassword ? <span className="text-xs text-muted-foreground">(saved/env)</span> : null}
                            {smsGwEnvFallback.password ? <span className="text-xs text-muted-foreground"> (env fallback)</span> : null}
                          </Label>
                          <Input
                            id="sms-password"
                            type="password"
                            value={smsGwPassword}
                            onChange={(e) => setSmsGwPassword(e.target.value)}
                            placeholder={smsGwPasswordConfigured ? "Leave blank to keep current" : "Zettatel password"}
                            autoComplete="new-password"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sms-apikey">
                            API Key {smsGwApiKeyConfigured && !smsGwApiKey ? <span className="text-xs text-muted-foreground">(saved/env)</span> : null}
                            {smsGwEnvFallback.apiKey ? <span className="text-xs text-muted-foreground"> (env fallback)</span> : null}
                          </Label>
                          <Input
                            id="sms-apikey"
                            type="password"
                            value={smsGwApiKey}
                            onChange={(e) => setSmsGwApiKey(e.target.value)}
                            placeholder={smsGwApiKeyConfigured ? "Leave blank to keep current" : "Optional if using user/password"}
                            autoComplete="new-password"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="sms-apiurl">
                            API URL {smsGwEnvFallback.apiUrl ? <span className="text-xs text-muted-foreground">(env fallback)</span> : null}
                          </Label>
                          <Input
                            id="sms-apiurl"
                            value={smsGwApiUrl}
                            onChange={(e) => setSmsGwApiUrl(e.target.value)}
                            placeholder="https://portal.zettatel.com/SMSApi/send"
                            autoComplete="off"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="sms-msgtype">Message type</Label>
                          <Select value={smsGwMsgType} onValueChange={setSmsGwMsgType}>
                            <SelectTrigger id="sms-msgtype">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">text</SelectItem>
                              <SelectItem value="unicode">unicode</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <Label htmlFor="sms-admin-otp">
                            Admin OTP phones{" "}
                            {smsGwEnvFallback.adminOtpPhones ? (
                              <span className="text-xs text-muted-foreground">(env OT_NUMBER fallback)</span>
                            ) : null}
                          </Label>
                          <Input
                            id="sms-admin-otp"
                            value={smsGwAdminOtpPhones}
                            onChange={(e) => setSmsGwAdminOtpPhones(e.target.value)}
                            placeholder="07… or +2547… (comma-separated for multiple)"
                            autoComplete="off"
                          />
                          <p className="text-xs text-muted-foreground">
                            Used for Jaba delete OTPs. M-Pesa change/unlock OTPs go to the integration phone in Notifications.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => void saveSmsGateway()} disabled={smsGwSaving}>
                          {smsGwSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          Save SMS gateway
                        </Button>
                      </div>

                      <Separator />

                      <div className="space-y-3">
                        <Label htmlFor="sms-test-phone">Send test SMS</Label>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <Input
                            id="sms-test-phone"
                            value={smsGwTestPhone}
                            onChange={(e) => setSmsGwTestPhone(e.target.value)}
                            placeholder="+2547…"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void testSmsGateway()}
                            disabled={smsGwTesting || !smsGwConfigured}
                          >
                            {smsGwTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            Send test
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Need Sender ID plus (User ID + Password) or API Key — from these fields or env. Do not mix
                          mismatched user/password with an API key; use one auth method.
                        </p>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="delivery" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground flex items-center gap-2">
                    <Truck className="h-5 w-5" />
                    E-commerce Delivery & Pickup
                  </CardTitle>
                  <CardDescription>
                    Configure delivery options and pickup address shown at checkout. These appear as selectable cards on the checkout page.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="pickupAddress">Pickup Address (Collect at Catha Lounge)</Label>
                    <Input
                      id="pickupAddress"
                      value={pickupAddress}
                      onChange={(e) => setPickupAddress(e.target.value)}
                      placeholder="e.g. Catha Lounge – Westlands, Nairobi"
                    />
                    <p className="text-xs text-muted-foreground">
                      Shown to customers when they choose &quot;Collect at Catha Lounge&quot;. Include exact address or &quot;exact address confirmed at order&quot;.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="pickupDirectionsUrl">Directions link</Label>
                    <Input
                      id="pickupDirectionsUrl"
                      type="url"
                      value={pickupDirectionsUrl}
                      onChange={(e) => setPickupDirectionsUrl(e.target.value)}
                      placeholder="https://maps.google.com/... or https://goo.gl/maps/..."
                    />
                    <p className="text-xs text-muted-foreground">
                      Optional. Add a Google Maps (or other) link so customers can open directions to Catha Lounge at checkout.
                    </p>
                  </div>

                  <Separator />

                  <div>
                    <Label className="text-card-foreground font-semibold">Delivery options</Label>
                    <p className="text-sm text-muted-foreground mb-4">
                      Edit label, fee (KES), and subtext for each option. Disabled options are hidden at checkout.
                    </p>
                    <div className="space-y-4">
                      {deliveryOptions.map((opt, index) => (
                        <div
                          key={`${opt.value}-${index}`}
                          className="rounded-lg border border-border p-4 space-y-3 bg-muted/20"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                              {opt.value === 'collect_at_catha_lodge' || opt.value.startsWith("collect_") ? (
                                <Store className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <MapPin className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="font-medium text-sm text-muted-foreground">{opt.value}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Label htmlFor={`opt-enabled-${index}`} className="text-sm">Show at checkout</Label>
                              <Switch
                                id={`opt-enabled-${index}`}
                                checked={opt.enabled}
                                onCheckedChange={(checked) => {
                                  setDeliveryOptions((prev) =>
                                    prev.map((o, i) => (i === index ? { ...o, enabled: !!checked } : o))
                                  )
                                }}
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label>Option key (internal ID)</Label>
                            <Input
                              value={opt.value}
                              onChange={(e) =>
                                setDeliveryOptions((prev) =>
                                  prev.map((o, i) =>
                                    i === index
                                      ? { ...o, value: e.target.value.trim().toLowerCase().replace(/\s+/g, "_") }
                                      : o
                                  )
                                )
                              }
                              placeholder="e.g. westlands"
                            />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label>Label</Label>
                              <Input
                                value={opt.label}
                                onChange={(e) =>
                                  setDeliveryOptions((prev) =>
                                    prev.map((o, i) => (i === index ? { ...o, label: e.target.value } : o))
                                  )
                                }
                                placeholder="e.g. Deliver to My Location"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label>Fee (KES)</Label>
                              <Input
                                type="number"
                                min={0}
                                value={opt.fee}
                                onChange={(e) =>
                                  setDeliveryOptions((prev) =>
                                    prev.map((o, i) => (i === index ? { ...o, fee: Number(e.target.value) || 0 } : o))
                                  )
                                }
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label>Subtext (shown under label)</Label>
                            <Input
                              value={opt.subtext}
                              onChange={(e) =>
                                setDeliveryOptions((prev) =>
                                  prev.map((o, i) => (i === index ? { ...o, subtext: e.target.value } : o))
                                )
                              }
                              placeholder="e.g. Delivery fee applies"
                            />
                          </div>
                          <div className="flex justify-end">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setDeliveryOptions((prev) => prev.filter((_, i) => i !== index))}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="outline" className="mt-4" onClick={addDeliveryOption}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add delivery option
                    </Button>
                  </div>

                  <Button onClick={saveDelivery} disabled={saving}>
                    {saving ? "Saving..." : "Save Delivery Settings"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ecommerce-hours" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Ecommerce opening hours
                  </CardTitle>
                  <CardDescription>
                    Show a notice on the public checkout page when the business is closed (Nairobi time). Customers can still pay unless you enable blocking below.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <p className="text-sm text-muted-foreground border border-border rounded-lg p-3 bg-muted/30">
                    All ecommerce time checks use Nairobi time (EAT).
                  </p>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
                    <div>
                      <Label htmlFor="eo-enabled" className="text-base font-semibold">
                        Enable ecommerce operating-hours notice
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        When enabled, closed periods show a notice before payment on checkout.
                      </p>
                    </div>
                    <Switch id="eo-enabled" checked={eoEnabled} onCheckedChange={setEoEnabled} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="eo-open">Opening time (24h HH:mm)</Label>
                      <Input
                        id="eo-open"
                        value={eoOpenTime}
                        onChange={(e) => setEoOpenTime(e.target.value)}
                        placeholder="09:00"
                        disabled={!eoEnabled}
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="eo-close">Closing time (24h HH:mm)</Label>
                      <Input
                        id="eo-close"
                        value={eoCloseTime}
                        onChange={(e) => setEoCloseTime(e.target.value)}
                        placeholder="18:00"
                        disabled={!eoEnabled}
                        className="font-mono"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>Open days</Label>
                    <div className="flex flex-wrap gap-4">
                      {EO_DAY_DEFS.map(({ value, label }) => (
                        <label key={value} className="flex items-center gap-2 text-sm cursor-pointer">
                          <Checkbox
                            checked={eoOpenDays.includes(value)}
                            disabled={!eoEnabled}
                            onCheckedChange={(c) => {
                              const on = c === true
                              setEoOpenDays((prev) => {
                                if (on) return [...new Set([...prev, value])].sort((a, b) => a - b)
                                return prev.filter((d) => d !== value)
                              })
                            }}
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Same-day hours only; closing must be after opening.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="eo-custom">Optional custom checkout notice</Label>
                    <Textarea
                      id="eo-custom"
                      value={eoCustomNotice}
                      onChange={(e) => setEoCustomNotice(e.target.value)}
                      disabled={!eoEnabled}
                      placeholder="If set, this text replaces the default closed message when the store is closed."
                      rows={3}
                      className="resize-y min-h-[80px]"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border p-4 bg-muted/15">
                    <div>
                      <Label htmlFor="eo-block" className="text-base font-semibold">
                        Block checkout while closed
                      </Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Optional: when on, checkout session creation is rejected during closed hours. Off by default (notice only).
                      </p>
                    </div>
                    <Switch id="eo-block" checked={eoBlockCheckout} onCheckedChange={setEoBlockCheckout} disabled={!eoEnabled} />
                  </div>

                  <Separator />

                  <div>
                    <Label className="font-semibold">Live preview (Nairobi)</Label>
                    <p className="text-sm text-muted-foreground mb-2">
                      Reflects the form above using the shared evaluator (not your device timezone).
                    </p>
                    <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2 text-sm">
                      <p>
                        <span className="text-muted-foreground">Store status:</span>{" "}
                        <span className="font-medium">{eoPreview.isOpen ? "Open" : "Closed"}</span>
                      </p>
                      {eoPreview.isClosed && eoEnabled && (
                        <div className="rounded-md border border-amber-200/80 bg-amber-50 dark:bg-amber-950/30 p-3 text-amber-950 dark:text-amber-100">
                          {eoPreview.message}
                        </div>
                      )}
                      {(!eoEnabled || eoPreview.isOpen) && (
                        <p className="text-muted-foreground">No checkout notice would be shown.</p>
                      )}
                    </div>
                  </div>

                  <Button onClick={saveEcommerceOpeningHours} disabled={saving}>
                    {saving ? "Saving..." : "Save ecommerce opening hours"}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="auth-health" className="space-y-6">
              <Card className="border-border bg-card">
                <CardHeader>
                  <CardTitle className="text-card-foreground flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Auth health monitor
                  </CardTitle>
                  <CardDescription>
                    Week-one auth stability dashboard with alert thresholds for success rate, timeout spikes, and duplicate-start locks.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex flex-wrap items-center gap-3">
                    <Label htmlFor="auth-health-days">Window</Label>
                    <Select
                      value={authHealthDays}
                      onValueChange={(value) => {
                        setAuthHealthDays(value)
                        fetchAuthHealth(value)
                      }}
                    >
                      <SelectTrigger id="auth-health-days" className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Last 24h</SelectItem>
                        <SelectItem value="7">Last 7 days</SelectItem>
                        <SelectItem value="14">Last 14 days</SelectItem>
                        <SelectItem value="30">Last 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2"
                      onClick={() => fetchAuthHealth()}
                      disabled={authHealthLoading}
                    >
                      <RefreshCw className={`h-4 w-4 ${authHealthLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                  </div>

                  {authHealthError && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {authHealthError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      { label: "Auth starts", value: authHealth?.summary.starts ?? 0 },
                      { label: "Success rate", value: `${authHealth?.summary.successRate ?? 0}%` },
                      { label: "Timeout rate", value: `${authHealth?.summary.timeoutRate ?? 0}%` },
                      { label: "Busy lock rate", value: `${authHealth?.summary.busyLockRate ?? 0}%` },
                    ].map((item) => (
                      <div key={item.label} className="rounded-lg border border-border bg-muted/20 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                        <p className="mt-1 text-2xl font-bold">{item.value}</p>
                      </div>
                    ))}
                  </div>

                  {authHealth?.alerts?.length ? (
                    <div className="space-y-3">
                      <Label className="font-semibold">Threshold alerts</Label>
                      {authHealth.alerts.map((alert) => (
                        <div
                          key={alert.code}
                          className={`rounded-lg border p-3 text-sm ${
                            alert.severity === "critical"
                              ? "border-red-300 bg-red-50 text-red-800"
                              : "border-amber-300 bg-amber-50 text-amber-800"
                          }`}
                        >
                          <p className="font-semibold flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            {alert.message}
                          </p>
                          <p className="mt-1">
                            Current: {alert.current}% · Threshold: {alert.threshold}%
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                      No threshold alerts detected for this time window.
                    </div>
                  )}

                  <div className="space-y-3">
                    <Label className="font-semibold">Daily auth trend</Label>
                    <div className="space-y-2">
                      {authDailyRows.map((row) => (
                        <div key={row.day} className="rounded-lg border border-border p-3">
                          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{row.day}</span>
                            <span>Start {row.start} · Success {row.success} · Timeout {row.timeout}</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded bg-muted">
                            <div
                              className="h-2 bg-blue-500"
                              style={{ width: `${(row.start / authDailyMax) * 100}%` }}
                            />
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
                            <div
                              className="h-2 bg-emerald-500"
                              style={{ width: `${(row.success / authDailyMax) * 100}%` }}
                            />
                          </div>
                          <div className="mt-1 h-2 w-full overflow-hidden rounded bg-muted">
                            <div
                              className="h-2 bg-amber-500"
                              style={{ width: `${(row.timeout / authDailyMax) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-lg border border-border p-4">
                      <Label className="font-semibold">Top return paths after auth</Label>
                      <div className="mt-3 space-y-2 text-sm">
                        {(authHealth?.topReturnPaths ?? []).slice(0, 8).map((item) => (
                          <div key={item.path} className="flex items-center justify-between gap-3">
                            <span className="truncate text-muted-foreground">{item.path}</span>
                            <Badge variant="secondary">{item.count}</Badge>
                          </div>
                        ))}
                        {!(authHealth?.topReturnPaths?.length) && (
                          <p className="text-muted-foreground">No return-path data yet.</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border p-4">
                      <Label className="font-semibold">Failure reasons</Label>
                      <div className="mt-3 space-y-2 text-sm">
                        {(authHealth?.failuresByReason ?? []).slice(0, 8).map((item) => (
                          <div key={item.reason} className="flex items-center justify-between gap-3">
                            <span className="truncate text-muted-foreground">{item.reason}</span>
                            <Badge variant="secondary">{item.count}</Badge>
                          </div>
                        ))}
                        {!(authHealth?.failuresByReason?.length) && (
                          <p className="text-muted-foreground">No failure reasons captured in this range.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

      <Dialog open={otpDialogOpen} onOpenChange={setOtpDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{otpDialogTitle}</DialogTitle>
            <DialogDescription>{otpDialogDescription}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-center py-2">
            <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOtpDialogOpen(false)
                setOtpValue("")
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={verifyIntegrationOtp}
              disabled={otpVerifying || otpValue.length !== 6}
            >
              {otpVerifying ? "Verifying..." : "Verify OTP"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
