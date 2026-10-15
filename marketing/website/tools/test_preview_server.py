"""Exercise real range responses, including first-byte, suffix and invalid ranges."""
from functools import partial
from http.server import ThreadingHTTPServer
from threading import Thread
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from serve_site import RangeHandler, SITE

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(RangeHandler, directory=str(SITE)))
worker = Thread(target=server.serve_forever, daemon=True)
worker.start()
base = f'http://127.0.0.1:{server.server_port}'
film = SITE / 'assets/video/launch-film.mp4'
try:
    with urlopen(Request(base+'/assets/video/launch-film.mp4', headers={'Range':'bytes=0-1023'})) as response:
        assert response.status == 206
        assert response.headers['Accept-Ranges'] == 'bytes'
        assert response.headers['Content-Range'] == f'bytes 0-1023/{film.stat().st_size}'
        assert response.read() == film.read_bytes()[:1024]
    with urlopen(Request(base+'/assets/video/launch-film.mp4', headers={'Range':'bytes=-64'})) as response:
        assert response.status == 206
        assert response.read() == film.read_bytes()[-64:]
    try:
        urlopen(Request(base+'/assets/video/launch-film.mp4', headers={'Range':'bytes=999999999-'}))
        raise AssertionError('Out-of-bounds range should fail')
    except HTTPError as error:
        assert error.code == 416
    with urlopen(base+'/index.html') as response:
        assert response.status == 200
        assert b'Rudra24 AI' in response.read()
    print('PASS: actual MP4 range, suffix, invalid range and home responses')
finally:
    server.shutdown()
    server.server_close()
