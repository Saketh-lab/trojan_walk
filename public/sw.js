// TrojanWalk service worker: shows pushes (labels only, never coordinates).
self.addEventListener("push", (event) => {
  const d = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(d.title || "TrojanWalk", {
      body: d.body,
      data: d,
      tag: d.request_id || d.session_id || "trojanwalk",
    })
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/map"));
});
