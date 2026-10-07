import { useEffect, useState } from 'react'

// Chrome and Edge (Android, Windows, Mac) offer a one-tap install; we keep that offer here
// so any "Get the app" button can use it. iPhones and iPads install from Safari's Share menu.
let promptEvent = null
const listeners = new Set()
const notify = () => listeners.forEach((listener) => listener())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    promptEvent = event
    notify()
  })
  window.addEventListener('appinstalled', () => {
    promptEvent = null
    notify()
  })
}

export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
}

export function platform() {
  const agent = window.navigator.userAgent
  if (/iPhone|iPad|iPod/.test(agent) || (agent.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(agent)) return 'android'
  return 'desktop'
}

export function useInstall() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, [])
  return {
    installed: isInstalled(),
    canPrompt: Boolean(promptEvent),
    platform: platform(),
    // Shows the browser's own install window; returns true when the person accepted.
    async prompt() {
      if (!promptEvent) return false
      const event = promptEvent
      promptEvent = null
      notify()
      await event.prompt()
      const choice = await event.userChoice
      return choice.outcome === 'accepted'
    },
  }
}
