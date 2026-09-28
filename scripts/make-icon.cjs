const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const size = 256;
const png = new PNG({ width: size, height: size });
const set = (x,y,r,g,b,a=255) => { const i=(size*y+x)<<2; png.data[i]=r;png.data[i+1]=g;png.data[i+2]=b;png.data[i+3]=a; };
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const radius=58, dx=Math.max(radius-x,0,x-(size-1-radius)), dy=Math.max(radius-y,0,y-(size-1-radius));
  if(dx*dx+dy*dy>radius*radius){set(x,y,0,0,0,0);continue}
  set(x,y,16,35,29);
}
for(let y=56;y<200;y++)for(let x=67;x<196;x++){
  const stem=x>=67&&x<101, cx=104, cy=128, rx=83, ry=72;
  const outer=((x-cx)/rx)**2+((y-cy)/ry)**2<=1;
  const inner=((x-107)/45)**2+((y-cy)/39)**2<1;
  if(stem||(outer&&!inner))set(x,y,57,207,145);
}
const pngBytes=PNG.sync.write(png);const ico=Buffer.alloc(22+pngBytes.length);ico.writeUInt16LE(0,0);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico[6]=0;ico[7]=0;ico[8]=0;ico[9]=0;ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(pngBytes.length,14);ico.writeUInt32LE(22,18);pngBytes.copy(ico,22);
const out=path.resolve(__dirname,'..','build','icon.ico');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,ico);console.log(out);
