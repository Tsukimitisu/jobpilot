import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const origin = 'http://127.0.0.1:4173'
await fetch(origin)
await mkdir('artifacts', { recursive: true })
const edge = process.env.JOBPILOT_BROWSER ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const browser = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9222', `--user-data-dir=${resolve('.browser-check', String(Date.now()))}`, 'about:blank'], { stdio: 'ignore' })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
let socket
try {
  let target
  for (let i = 0; i < 50; i++) {
    try { target = await (await fetch('http://127.0.0.1:9222/json/new?about:blank', { method: 'PUT' })).json(); break } catch { await pause(100) }
  }
  assert.ok(target, 'Edge CDP did not start')
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }))
  let sequence = 0
  const pending = new Map()
  const listeners = new Map()
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value) }, reject: reason => { clearTimeout(timer); reject(reason) } })
    socket.send(JSON.stringify({ id, method, params }))
  })
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const task = pending.get(message.id); pending.delete(message.id)
      if (message.error) task?.reject(new Error(message.error.message)); else task?.resolve(message.result)
    } else for (const listener of listeners.get(message.method) ?? []) listener(message.params)
  })
  const on = (event, handler) => listeners.set(event, [...(listeners.get(event) ?? []), handler])
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }
  const waitFor = async expression => {
    for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await pause(100) }
    throw new Error(`Browser condition failed: ${expression}`)
  }
  const owner = '10000000-0000-0000-0000-000000000001'
  const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.inert-signature`
  const user = { id: owner, email: 'browser-owner@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
  let profile = null
  let resumes = []
  let defaultId = null
  let mutationCount = 0
  let gmail = null
  let rejectGmail = false
  let application = null
  let sendCount = 0
  let failApplicationSend = false
  const sources = [{ id: 'source-fixture', kind: 'gmail', source_key: 'Label_fixture', name: 'JobPilot/Alerts', enabled: true, cursor: null, last_success_at: '2026-01-01T00:00:00Z' }]
  const jobs = [{ id: 'job-fixture', owner_id: owner, title: 'Frontend Engineer', company: 'Fixture Company', location: null, work_mode: null, canonical_url: 'https://example.invalid/jobs/42', description: 'Inert browser fixture. No real mailbox content.', requirements: ['React', 'TypeScript'], uncertainty: ['Location and work mode unknown. Verify the source.'], published_at: null, created_at: '2026-01-01T00:00:00Z' }]
  const reviews = [{ job_id: 'job-fixture', owner_id: owner, disposition: 'new', reviewed: false }]
  const consoleErrors = []
  on('Runtime.exceptionThrown', event => consoleErrors.push(event.exceptionDetails.text))
  on('Fetch.requestPaused', async ({ requestId, request }) => {
    const url = new URL(request.url)
    if (url.origin === origin) { await send('Fetch.continueRequest', { requestId }); return }
    let body = null, status = 200
    const headers = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: origin }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PATCH,DELETE,OPTIONS' }]
    if (request.method === 'OPTIONS') body = {}
    else if (url.pathname === '/auth/v1/token') body = { access_token: token, refresh_token: 'inert-refresh', expires_in: 3600, token_type: 'bearer', user }
    else if (url.pathname === '/auth/v1/user') body = user
    else if (url.pathname === '/rest/v1/rpc/is_jobpilot_owner') body = true
    else if (url.pathname === '/rest/v1/owner_profiles') {
      if (request.method === 'POST') { profile = { ...JSON.parse(request.postData), updated_at: '2026-10-11T00:00:00Z' }; mutationCount++ }
      body = profile ? (request.headers.Accept?.includes('object') || request.headers.accept?.includes('object') ? profile : [profile]) : []
    } else if (url.pathname === '/rest/v1/gmail_connections') body = gmail ? [gmail] : []
    else if (url.pathname === '/rest/v1/job_sources') body = sources
    else if (url.pathname === '/rest/v1/imported_jobs') body = jobs
    else if (url.pathname === '/rest/v1/import_runs') body = []
    else if (url.pathname === '/rest/v1/applications') body = application ? [application] : []
    else if (url.pathname === '/rest/v1/job_origins') body = [{ id: 'origin-fixture', job_id: 'job-fixture', source_id: 'source-fixture', message_id: 'message-fixture', sender: 'alerts@example.invalid', source_date: '2026-01-01T00:00:00Z', source_url: 'https://mail.google.com/mail/u/0/#all/message-fixture' }]
    else if (url.pathname === '/rest/v1/job_reviews') {
      if (request.method === 'PATCH') Object.assign(reviews[0], JSON.parse(request.postData))
      body = request.headers.Accept?.includes('object') || request.headers.accept?.includes('object') ? reviews[0] : reviews
    } else if (url.pathname === '/functions/v1/jobpilot-api') {
      const input = JSON.parse(request.postData)
      if (input.action === 'labels') body = { labels: [{ id: 'Label_fixture', name: 'JobPilot/Alerts' }] }
      else if (input.action === 'check_gmail' && rejectGmail) { gmail.status = 'reconnect_required'; gmail.error_code = 'reconnect_required'; status = 400; body = { error: 'reconnect_required' } }
      else if (input.action === 'disconnect') { gmail = { expected_email: user.email, status: 'disconnected' }; body = { ok: true } }
      else if (input.action === 'application_create') {
        application ??= { id: 'application-fixture', owner_id: owner, job_id: 'job-fixture', recipient: '', recipient_verified: false, subject: 'Application: Frontend Engineer', body: 'Hello,\n\nPlease review my attached resume for this position.\n\nThank you,\nBrowser Test Owner', resume_id: null, status: 'draft', revision: 1, created_at: '2026-01-01', updated_at: '2026-01-01' }
        body = application
      } else if (input.action?.startsWith('application_')) {
        if (input.action === 'application_send' && failApplicationSend) { status = 500; body = {error:'request_failed'} }
        else {
        if (input.action === 'application_save') Object.assign(application, input, { status: 'draft' })
        if (input.action === 'application_ready') Object.assign(application, { status: 'ready', sender_email: user.email, resume_name: resumes[0].original_name, resume_bytes: resumes[0].byte_size, resume_sha256: 'fixture-checksum' })
        if (input.action === 'application_send') { assert.equal(input.confirmed, true); sendCount++; Object.assign(application, { status: 'sent', gmail_message_id: 'inert-browser-message', sent_at: '2026-01-01' }) }
        if (input.action !== 'application_refresh') application.revision++
        body = application
        }
      }
      else body = { ok: true, added: 0, duplicates: 1, more: false }
    } else if (url.pathname === '/rest/v1/resumes') body = resumes
    else if (url.pathname === '/rest/v1/resume_defaults') body = defaultId ? [{ resume_id: defaultId }] : []
    else { status = 403; body = { message: 'External network blocked by local browser test' } }
    await send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers, body: Buffer.from(JSON.stringify(body)).toString('base64') })
  })
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  await send('Page.enable'); await send('Runtime.enable')
  await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  await send('Page.navigate', { url: `${origin}/profile` })
  await waitFor(`!!document.querySelector('#email')`)
  const fill = (id, value) => evaluate(`(() => { const input = document.getElementById(${JSON.stringify(id)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await fill('email', user.email); await fill('password', 'inert-browser-test')
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`!!document.querySelector('#full_name')`)
  await fill('full_name', 'Browser Test Owner'); await fill('contact_email', user.email)
  await evaluate(`document.querySelector('button[type="submit"]').click()`)
  await waitFor(`document.body.textContent.includes('Profile saved.')`)
  assert.equal(mutationCount, 1)
  await send('Page.reload')
  await waitFor(`document.querySelector('#full_name')?.value === 'Browser Test Owner'`)
  for (const [width, height] of [[360, 800], [375, 812], [390, 844], [768, 1024], [1024, 768], [1440, 1000], [932, 360]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 })
    await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900 })
    await pause(100)
    const layout = await evaluate(`({ width: innerWidth, scroll: document.documentElement.scrollWidth, inputs: [...document.querySelectorAll('input,textarea,select')].every(e => e.getBoundingClientRect().right <= innerWidth + 1), nav: [...document.querySelectorAll('nav')].some(e => e.getBoundingClientRect().height > 0) })`)
    assert.ok(layout.scroll <= layout.width + 1 && layout.inputs && layout.nav, `layout overflow at ${width}: ${JSON.stringify(layout)}`)
    if (width === 390 || width === 1440) {
      const image = await send('Page.captureScreenshot', { format: 'png' })
      await writeFile(`artifacts/profile-${width}.png`, Buffer.from(image.data, 'base64'))
    }
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await evaluate(`document.querySelector('#full_name').focus()`)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  assert.equal(await evaluate('document.activeElement.id'), 'contact_email', 'keyboard focus follows form order')
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
  assert.ok(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`))
  await fill('full_name', 'Unsaved browser draft')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await waitFor(`!navigator.onLine && document.querySelector('button[type="submit"]').disabled`)
  assert.equal(await evaluate(`document.querySelector('#full_name').value`), 'Unsaved browser draft')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: 0, uploadThroughput: 0 })
  await evaluate(`document.querySelector('a[href="/settings"]').click()`)
  await waitFor(`!![...document.querySelectorAll('a')].find(a => a.textContent === 'Resumes')`)
  resumes = [{ id: '20000000-0000-0000-0000-000000000001', owner_id: owner, object_path: `${owner}/20000000-0000-0000-0000-000000000001.pdf`, original_name: 'A-long-but-readable-private-resume-file-name.pdf', byte_size: 2048, status: 'ready', created_at: '2026-10-11T00:00:00Z' }]
  defaultId = resumes[0].id
  await evaluate(`[...document.querySelectorAll('a')].find(a => a.textContent === 'Resumes').click()`)
  await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh list')`)
  await evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Refresh list').click()`)
  await waitFor(`document.body.textContent.includes('Default resume')`)
  for (const width of [390, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 900 })
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `resume overflow at ${width}`)
    const image = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(`artifacts/resumes-${width}.png`, Buffer.from(image.data, 'base64'))
  }
  const clickText = text => evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent === ${JSON.stringify(text)}); if (!button || button.disabled) throw new Error('Unavailable button'); button.click(); })()`)
  await evaluate(`document.querySelector('a[href="/settings"]').click()`)
  await waitFor(`document.body.textContent.includes('Gmail connection') && document.body.textContent.includes('Disconnected')`)
  gmail = { status: 'connected', expected_email: user.email, connected_email: user.email, checked_at: '2026-01-01T00:00:00Z', error_code: null }
  await clickText('Refresh source status')
  await waitFor(`!![...document.querySelectorAll('.badge')].find(e => e.textContent === 'Connected')`)
  await clickText('Load Gmail labels')
  await waitFor(`!!document.querySelector('#gmail-label')`)
  await clickText('Confirm label')
  await waitFor(`document.body.textContent.includes('Gmail import label confirmed.')`)
  for (const route of ['settings', 'jobs']) {
    await evaluate(`document.querySelector('a[href="/${route}"]').click()`)
    await waitFor(route === 'jobs' ? `!!document.querySelector('.job-item')` : `!!document.querySelector('#gmail-address')`)
    for (const [width, height] of [[360, 800], [375, 812], [390, 844], [768, 1024], [1024, 768], [1440, 1000], [932, 360]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 900 })
      await send('Emulation.setTouchEmulationEnabled', { enabled: width < 900 })
      await pause(100)
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `${route} overflow at ${width}`)
      assert.ok(await evaluate(`[...document.querySelectorAll('button,summary,input,select,textarea')].filter(e => e.getClientRects().length).every(e => (e.type === 'checkbox' ? e.closest('label') : e).getBoundingClientRect().height >= 44)`), `${route} small touch target at ${width}`)
      if (width === 390 || width === 1440) { const screenshot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }); await writeFile(`artifacts/${route}-${width}.png`, Buffer.from(screenshot.data, 'base64')) }
    }
  }
  await clickText('Save job')
  await waitFor(`!![...document.querySelectorAll('button')].find(e => e.textContent === 'Unsave job')`)
  gmail.send_consented_at = '2026-01-01'; gmail.granted_scopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send']
  await clickText('Create application draft')
  await waitFor(`!!document.querySelector('#application-recipient')`)
  assert.equal(await evaluate(`document.querySelector('#application-recipient').value`), '', 'alert sender must never fill employer recipient')
  await fill('application-recipient', 'employer@example.invalid')
  await evaluate(`document.querySelector('.choice-list input').click()`)
  await evaluate(`(() => { const select = document.querySelector('#application-resume'); select.value = ${JSON.stringify(resumes[0].id)}; select.dispatchEvent(new Event('change', {bubbles:true})); })()`)
  await clickText('Save draft')
  await waitFor(`!![...document.querySelectorAll('button')].find(b => b.textContent === 'Review final email' && !b.disabled)`)
  for (const surface of ['application-editor', 'application-review']) {
    if (surface === 'application-review') { await clickText('Review final email'); await waitFor(`!!document.querySelector('#final-email-heading')`) }
    for (const [width,height] of [[360,800],[375,812],[390,844],[768,1024],[1024,768],[1440,1000],[932,360]]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:width<900})
      await send('Emulation.setTouchEmulationEnabled', {enabled:width<900})
      await pause(100)
      assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), `${surface} overflow at ${width}`)
      assert.ok(await evaluate(`[...document.querySelectorAll('button,summary,input,select,textarea')].filter(e => e.getClientRects().length).every(e => (e.type === 'checkbox' ? e.closest('label') : e).getBoundingClientRect().height >= 44)`), `${surface} touch target at ${width}`)
      if (width===390 || width===1440) { const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile(`artifacts/${surface}-${width}.png`,Buffer.from(shot.data,'base64')) }
    }
  }
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send email').disabled`),'final send requires confirmation')
  await send('Emulation.setDeviceMetricsOverride',{width:360,height:800,deviceScaleFactor:1,mobile:true})
  failApplicationSend = true
  await evaluate(`document.querySelector('.choice-list input').click()`)
  await clickText('Confirm and send email')
  await waitFor(`document.body.textContent.includes('Sending is locked until Refresh status')`)
  assert.ok(await evaluate(`document.querySelector('.choice-list input').disabled`),'uncertain send locks confirmation')
  failApplicationSend = false
  await clickText('Refresh status')
  await waitFor(`!document.querySelector('.choice-list input').disabled`)
  assert.ok(await evaluate(`!document.querySelector('.choice-list input').checked`),'status refresh still requires new confirmation')
  await evaluate(`document.querySelector('.choice-list input').click()`)
  await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm and send email'); b.click(); b.click(); })()`)
  await waitFor(`document.body.textContent.includes('Gmail accepted this email')`)
  assert.equal(sendCount,1,'duplicate taps send one mocked request')
  for (const state of ['sending','delivery_unknown','failed','external']) {
    application.status=state;application.attempt_id='inert-attempt';application.sending_at='2026-01-01';application.external_sent_at='2026-01-01'
    await clickText('Refresh status')
    await waitFor(`document.querySelector('.application-editor .badge')?.textContent === ${JSON.stringify({sending:'Sending',delivery_unknown:'Delivery unknown',failed:'Failed',external:'Sent outside JobPilot'}[state])}`)
    assert.ok(await evaluate(`![...document.querySelectorAll('button')].some(b=>b.textContent==='Confirm and send email')`),`${state} cannot send directly`)
    assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth + 1'),`${state} overflow`)
  }
  await evaluate(`document.querySelector('a[href="/jobs"]').click()`)
  await waitFor(`!![...document.querySelectorAll('button')].find(e => e.textContent === 'Dismiss job')`)
  await clickText('Dismiss job')
  await waitFor(`document.body.textContent.includes('No jobs match these filters.')`)
  await evaluate(`document.querySelector('a[href="/settings"]').click()`)
  await waitFor(`!!document.querySelector('#gmail-address')`)
  rejectGmail = true
  await clickText('Check Gmail access')
  await waitFor(`!![...document.querySelectorAll('.badge')].find(e => e.textContent === 'Reconnect required')`)
  await clickText('Disconnect Gmail')
  await waitFor(`!![...document.querySelectorAll('.badge')].find(e => e.textContent === 'Disconnected')`)
  await waitFor(`navigator.serviceWorker.getRegistration().then(r => !!r?.active)`)
  const caches = await evaluate(`(async () => { const names = await window.caches.keys(); return (await Promise.all(names.map(async name => (await (await window.caches.open(name)).keys()).map(r => r.url)))).flat() })()`)
  assert.ok(caches.length > 0)
  assert.ok(caches.every(url => new URL(url).origin === origin && !/\/rest\/|\/auth\/|\/storage\/|\/functions\/|signed|blob:/.test(url)), 'private data in service-worker cache')
  const storageKeys = await evaluate('Object.keys(localStorage)')
  assert.ok(storageKeys.every(key => key.startsWith('sb-') && key.endsWith('-auth-token')), 'non-session browser persistence found')
  assert.deepEqual(consoleErrors, [])
  console.log(`Real headless Edge PASS with mocked Supabase: login, profile save/reload, offline drafts, job save/dismiss, label confirmation, Gmail states, application draft/review/explicit confirmation/duplicate taps/statuses, layouts at 360/375/390/768/1024/1440 and landscape, ${caches.length} public cache entries, session-only localStorage. Screenshots: artifacts/. No phone installation or live Gmail/hosted checks.`)
  await send('Browser.close').catch(() => {})
} finally {
  socket?.close()
  browser.kill()
}
