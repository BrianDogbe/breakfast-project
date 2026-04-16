/* API base for static HTML pages (customer, admin, rider). Override before this script if needed:
 *   <script>window.BREAKFAST_API_BASE = "http://192.168.1.10:4000";</script>
 */
(function (w) {
  if (!w.BREAKFAST_API_BASE) {
    w.BREAKFAST_API_BASE = "http://127.0.0.1:4000";
  }
})(typeof window !== "undefined" ? window : globalThis);
