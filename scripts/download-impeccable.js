const https = require('https');
const fs = require('fs');
const path = require('path');

const targetDir = path.resolve('c:/Users/Khushi/Desktop/A.I. Leads Agent (2)/.agents/skills/impeccable');
const refDir = path.join(targetDir, 'reference');

if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
if (!fs.existsSync(refDir)) fs.mkdirSync(refDir, { recursive: true });

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'NodeJS' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}: status ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function run() {
  console.log('Downloading Impeccable skill from pbakaus/impeccable...');

  // 1. Download SKILL.src.md as SKILL.md
  try {
    const skillContent = await fetchUrl('https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/SKILL.src.md');
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillContent, 'utf8');
    console.log('✓ Downloaded SKILL.md');
  } catch (err) {
    console.error('Error downloading SKILL.md:', err.message);
  }

  // 2. Download key reference playbooks
  const references = [
    'animate.md', 'polish.md', 'craft.md', 'craft-floor.md', 'critique.md',
    'delight.md', 'layout.md', 'typeset.md', 'colorize.md', 'bolder.md',
    'quieter.md', 'distill.md', 'clarify.md', 'harden.md', 'optimize.md',
    'adapt.md', 'audit.md', 'doctor.md', 'init.md', 'new-work.md'
  ];

  for (const ref of references) {
    try {
      const content = await fetchUrl(`https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/reference/${ref}`);
      fs.writeFileSync(path.join(refDir, ref), content, 'utf8');
      console.log(`✓ Downloaded reference/${ref}`);
    } catch (err) {
      console.warn(`Could not download ${ref}:`, err.message);
    }
  }

  console.log('Done installing Impeccable skill!');
}

run();
