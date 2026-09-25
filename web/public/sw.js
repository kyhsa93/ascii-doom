/*
  The service worker.

  Deliberately the smallest thing that makes the game work without a network.
  It is also the only file in this project that nothing checks: it is plain
  JavaScript in `public/`, so `tsc` never sees it (the config includes `web`
  but not `allowJs`) and it cannot be imported into a Node check, because half
  of what it does only exists inside a worker. So the logic stays small enough
  to read in one go, and the claim that it works is made by a browser check
  that turns the network off rather than by this comment.

  Bumped by hand: Vite copies `public/` through verbatim, so there is no build
  step to substitute a version in here. Changing it retires every old cache on
  the next activate.
*/
const CACHE = 'ascii-doom-v1'

/*
  The page, by its directory URL. Relative to this file, which the browser
  resolves against the worker's own location — so it is `/ascii-doom/` on Pages
  and whatever the local server uses in a check, without either being written
  down.
*/
const SHELL = './'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      const response = await fetch(SHELL, { cache: 'reload' })
      await cache.put(SHELL, response.clone())

      /*
        The build hashes its asset names and this file is copied through
        without substitution, so the only place those names exist is the page
        that references them. Reading them out of the shell is what makes one
        visit enough: on a first load the worker is not yet controlling the
        page, so every asset request goes straight past it and is never seen
        again — and going offline would then serve a cached page pointing at
        scripts that are not there.
      */
      const urls = new Set()
      for (const match of (await response.text()).matchAll(/(?:src|href)="([^"]+)"/g)) {
        const href = match[1]
        if (href.startsWith('http') || href.startsWith('//') || href.startsWith('data:')) continue
        urls.add(new URL(href, self.location.href).href)
      }
      // One at a time would be tidier and four times slower; a miss is not
      // worth failing an install over.
      await Promise.all([...urls].map((url) => cache.add(url).catch(() => {})))

      await self.skipWaiting()
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    /*
      The page is the one file the build does not hash, so serving it from the
      cache first would pin the game to whatever version was installed and never
      let go. Network first, with the cache as the fallback that makes it work
      on a train.
    */
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(SHELL, copy))
          return response
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    )
    return
  }

  /*
    Everything else carries a content hash in its name, so a hit is always the
    right bytes and a miss is always worth keeping.
  */
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
