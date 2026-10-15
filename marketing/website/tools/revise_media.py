"""Prepare small excerpts from the supplied film; original media stays untouched."""
from pathlib import Path
import subprocess
import sys

SITE = Path(__file__).resolve().parents[1]
FFMPEG = Path.home() / 'AppData/Local/Temp/rudra24-website-media-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'
SOURCE = SITE / 'assets/video/launch-film.mp4'

def run(*args):
    subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)], check=True)

if __name__ == '__main__':
    if not FFMPEG.exists():
        sys.exit('Set FFMPEG to your installed ffmpeg binary before regenerating media.')
    run('-i', SITE.parents[1]/'assets/rudra24-icon.png', '-vf', 'scale=128:128', '-frames:v', 1, SITE/'assets/rudra24-icon.png')
    for key, second in [('leads',40),('calling',90),('outreach',112),('crm',146),('assistant',164)]:
        run('-ss',second,'-i',SOURCE,'-t',10,'-an','-c:v','libx264','-preset','fast','-crf',18,'-movflags','+faststart',SITE/f'assets/video/{key}.mp4')
        run('-ss',second+3,'-i',SOURCE,'-frames:v',1,'-q:v',2,SITE/f'assets/video/{key}-poster.jpg')
        print(f'Prepared {key}', flush=True)
    run('-ss',43,'-i',SOURCE,'-frames:v',1,'-q:v',2,SITE/'assets/video/launch-poster.jpg')
