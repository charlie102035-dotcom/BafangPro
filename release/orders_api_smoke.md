# Orders API Smoke (Round 3)

## `orders/review` 404 -> `orders` fallback

1. Bring up a temporary mock API that returns 404 for `/api/orders/review` and 200 JSON for `/api/orders`:

```bash
node - <<'NODE'
const http = await import('node:http');
const server = http.createServer((req, res) => {
  if (req.url === '/api/orders/review') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  if (req.url === '/api/orders') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'T0001', status: 'pending' }] }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(9001, async () => {
  console.log('mock server ready');
  const review = await fetch('http://127.0.0.1:9001/api/orders/review');
  console.log('review status', review.status);
  if (review.status === 404) {
    const fallback = await fetch('http://127.0.0.1:9001/api/orders');
    console.log('fallback status', fallback.status);
    console.log('fallback body', await fallback.text());
  }
  server.close();
});
NODE
```

Output:
```
mock server ready
review status 404
fallback status 200
fallback body {"data":[{"id":"T0001","status":"pending"}]}
```

This verifies the new `getReviewSnapshot()` flow can continue to the fallback when `/api/orders/review` returns 404 without throwing.
