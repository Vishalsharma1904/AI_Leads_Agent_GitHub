"""Real loopback HTTP with application startup, workers and clean shutdown."""
import json
import socket
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import main
import uvicorn


class ServerStartupTest(unittest.TestCase):
    def test_server_boots_serves_http_and_stops(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            address = 'http://127.0.0.1:' + str(listener.getsockname()[1])
            server = uvicorn.Server(uvicorn.Config(main.app, log_level='warning', lifespan='on'))
            thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
            thread.start()
            try:
                deadline = time.monotonic() + 45
                while not server.started and thread.is_alive() and time.monotonic() < deadline:
                    time.sleep(.05)
                self.assertTrue(server.started, 'Server did not complete real startup')
                with urlopen(address + '/health', timeout=5) as reply:
                    self.assertEqual(reply.status, 200)
                    self.assertEqual(json.load(reply)['services']['db'], 'ok')
                with urlopen(address + '/api/public-config', timeout=5) as reply:
                    self.assertEqual(reply.status, 200)
                with self.assertRaises(HTTPError) as error:
                    urlopen(address + '/api/capabilities', timeout=5)
                self.assertEqual(error.exception.code, 401)
                error.exception.close()
                preflight = Request(address + '/api/credentials', method='OPTIONS', headers={
                    'Origin': 'http://localhost:3210',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'authorization,content-type'})
                with urlopen(preflight, timeout=5) as reply:
                    self.assertEqual(reply.headers['Access-Control-Allow-Origin'], 'http://localhost:3210')
            finally:
                server.should_exit = True
                thread.join(15)
                self.assertFalse(thread.is_alive(), 'Server workers did not stop cleanly')


if __name__ == '__main__': unittest.main()
