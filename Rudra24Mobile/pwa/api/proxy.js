// Vercel function. Backend destination is operator-controlled, never a query parameter.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  const configured=process.env.RUDRA_BACKEND_URL;
  if(!configured)return res.status(503).json({detail:'Set RUDRA_BACKEND_URL to your deployed HTTPS backend.'});
  let base;try{base=new URL(configured);if(base.protocol!=='https:'||base.username||base.password||base.pathname!=='/'||base.search||base.hash)throw Error();}catch{return res.status(503).json({detail:'RUDRA_BACKEND_URL must be an HTTPS origin.'});}
  const path=String(req.query.path||'').replace(/^\/+/, '');
  if(!/^[A-Za-z0-9_\-/]+$/.test(path)||path.split('/').includes('..'))return res.status(400).json({detail:'Invalid API path'});
  if(!['GET','POST','PUT','PATCH','DELETE'].includes(req.method))return res.status(405).json({detail:'Method not allowed'});
  const url=new URL('/api/'+path,base);
  for(const [key,value] of Object.entries(req.query))if(key!=='path')url.searchParams.set(key,String(value));
  try{
    const response=await fetch(url,{method:req.method,headers:{'Content-Type':'application/json',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['idempotency-key']?{'Idempotency-Key':req.headers['idempotency-key']}: {})},body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body),signal:AbortSignal.timeout(25000),redirect:'error'});
    res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');
    return res.status(response.status).send(await response.text());
  }catch{return res.status(502).json({detail:'Backend could not be reached. Refresh status before retrying a submission.'});}
}
