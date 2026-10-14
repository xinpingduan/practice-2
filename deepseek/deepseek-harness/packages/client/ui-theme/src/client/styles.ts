import type { Context } from '@deepseek-ai/cordis'
import base from '../styles/base.css?inline'
import cornerShape from '../styles/corner-shape.css?inline'
import designPlatform from '../styles/design-platform.css?inline'
import scrollbar from '../styles/scrollbar.css?inline'
import gradientShadowText from '../styles/gradient-shadow-text.css?inline'
import shiki from '../styles/shiki.css?inline'
import smartOffice from '../styles/smart-office.css?inline'

const PLUGIN_ID = '@deepseek-ai/dsh-client-ui-theme'

const STYLES = [
  ['base.css', base],
  ['corner-shape.css', cornerShape],
  ['design-platform.css', designPlatform],
  ['scrollbar.css', scrollbar],
  ['gradient-shadow-text.css', gradientShadowText],
  ['shiki.css', shiki],
  ['smart-office.css', smartOffice],
] as const

/**
 * Mount the global theme sheets for exactly the owning plugin lifetime.
 * @param ctx - Owning plugin context.
 */
export function installThemeStyles(ctx: Context): void {
  if (typeof document === 'undefined') return
  // Keep the management-system palette scoped to the embedded Smart Office
  // deployment; ordinary Harness sessions retain the built-in theme.
  const isSmartOffice = (window.location.hostname === '127.0.0.1'
    || window.location.hostname === 'localhost')
    && window.location.port === '8080'
    && new URLSearchParams(window.location.search).has('office_token')
  if (isSmartOffice) document.body.dataset.dshSmartOffice = 'true'
  ctx.effect(() => () => {
    if (isSmartOffice) delete document.body.dataset.dshSmartOffice
  }, 'ui-theme: smart office marker')
  for (const [name, css] of STYLES) {
    ctx.effect(() => {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = `${PLUGIN_ID}/${name}`
      tag.textContent = css
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, `ui-theme: ${name} stylesheet`)
  }
}
