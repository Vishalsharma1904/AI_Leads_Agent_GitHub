const esbuild=require('esbuild');
esbuild.buildSync({entryPoints:['src/rudra-motion-ui.jsx'],bundle:true,minify:true,format:'iife',target:'es2020',define:{'process.env.NODE_ENV':'"production"'},outfile:'rudra-motion-ui.js',legalComments:'eof'});
console.log('React/Motion bundle built.');
