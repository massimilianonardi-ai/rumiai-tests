'use strict';

// Real product entrypoint, real Chromium TLS verification and a disposable NSS
// trusted root. No certificate-error suppression or network stubbing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const {spawn, spawnSync} = require('node:child_process');

const productRoot = process.argv[2];
const command = path.join(productRoot, 'bin/sys/web-analyze');
const {auditWebAnalyzeEvidence} = require(
  path.join(productRoot, 'lib/sys/js/web-analyze-rest.lib.js'));

function execute(bin, args, cwd)
{
  const result = spawnSync(bin, args, {cwd, encoding:'utf8', timeout:20000});
  assert.equal(result.error, undefined, 'TLS fixture utility failed to start: ' + bin);
  assert.equal(result.status, 0,
    'TLS fixture utility failed: ' + bin + ' (' + result.status + ')\n' +
    String(result.stderr || '').slice(-500));
}

function certificates(work)
{
  execute('openssl', [
    'req','-x509','-newkey','rsa:2048','-sha256','-nodes',
    '-days','2','-subj','/CN=RumiAI disposable TLS fixture CA',
    '-addext','basicConstraints=critical,CA:TRUE',
    '-addext','keyUsage=critical,keyCertSign,cRLSign',
    '-keyout','ca.key','-out','ca.pem'
  ], work);
  execute('openssl', [
    'req','-newkey','rsa:2048','-sha256','-nodes',
    '-subj','/CN=localhost',
    '-keyout','server.key','-out','server.csr'
  ], work);
  fs.writeFileSync(path.join(work,'server.ext'), [
    'subjectAltName=DNS:localhost,IP:127.0.0.1',
    'basicConstraints=critical,CA:FALSE',
    'keyUsage=critical,digitalSignature,keyEncipherment',
    'extendedKeyUsage=serverAuth'
  ].join('\n') + '\n',{mode:0o600});
  execute('openssl', [
    'x509','-req','-in','server.csr','-CA','ca.pem',
    '-CAkey','ca.key','-CAcreateserial','-out','server.pem',
    '-days','2','-sha256','-extfile','server.ext'
  ],work);
}

function browserTrust(work)
{
  // The validation environment owns its HOME. Tests may set up fixture data
  // inside that supplied disposable environment but must not replace it.
  const home = process.env.HOME;
  assert(home && home === process.env.RUMIAI_TEST_TLS_EPHEMERAL_HOME,
    'HTTPS fixture requires an externally supplied disposable HOME');
  const db = path.join(home,'.pki','nssdb');
  fs.mkdirSync(db, {mode:0o700, recursive:true});
  execute('certutil',['-N','-d','sql:' + db,'--empty-password'],work);
  execute('certutil',[
    '-A','-d','sql:' + db,'-n','RumiAI disposable fixture CA',
    '-t','C,,','-i',path.join(work,'ca.pem')
  ],work);
}

function run(commandArgs, env)
{
  return new Promise((resolve,reject) =>
  {
    const child = spawn(process.execPath,[command,...commandArgs],
      {env,stdio:['ignore','pipe','pipe']});
    let stdout='', stderr='';
    const cap = (value, chunk) => (value + chunk).slice(-8192);
    child.stdout.on('data', chunk => {stdout=cap(stdout,chunk.toString());});
    child.stderr.on('data', chunk => {stderr=cap(stderr,chunk.toString());});
    const timeout = setTimeout(() => child.kill('SIGKILL'),120000);
    child.once('error',error => {clearTimeout(timeout);reject(error);});
    child.once('close',code =>
    {
      clearTimeout(timeout);
      resolve({code,stdout,stderr});
    });
  });
}

function inspect(capture, url, expectedLeaf)
{
  const securityFile = path.join(capture,'rest/security/index.json');
  const security = JSON.parse(fs.readFileSync(securityFile,'utf8'));
  const capabilities = JSON.parse(fs.readFileSync(path.join(
    capture,'cdp-capabilities.json'),'utf8'));
  assert.equal(security.scope,'observed-frame-and-network-security');
  assert.equal(security.source.status,'saved');
  assert.equal(security.certificateMethod.support,'supported',
    'real Chromium must advertise Network.getCertificate for this test');
  const origin = new URL(url).origin;
  assert(security.frames.some(frame => frame.securityOrigin === origin &&
    frame.secureContextType !== 'InsecureScheme'),
  'HTTPS frame must be observed as a secure browser document');
  const response = security.responses.find(row =>
    row.url?.startsWith(origin + '/') && row.status === 200 &&
    row.tlsDetailsStatus === 'saved');
  assert(response, 'secure HTTPS network response with TLS details was not observed');
  assert(response.securityDetails?.protocol?.startsWith('TLS'),
    'Chromium did not expose real TLS protocol details');
  assert(response.securityState === 'secure',
    'Chromium did not report a secure response');
  const cert = security.certificates.find(item => item.origin === origin);
  assert(cert, 'no certificate lookup was recorded for observed HTTPS frame');
  assert.equal(cert.status, 'saved',
    'positive HTTPS certificate-chain acquisition failed: ' +
    (cert.errorCode || 'unknown'));
  assert(cert.certificates >= 1);
  assert.equal(security.certificateDiscovery,'saved');
  const archive = path.join(capture,'rest',cert.file);
  assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
  const raw = fs.readFileSync(archive);
  assert.equal(raw.length,cert.bytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),cert.sha256);
  const chain = JSON.parse(raw.toString('utf8'));
  assert.equal(chain.origin,origin);
  assert(Array.isArray(chain.result?.tableNames));
  const leaf = new crypto.X509Certificate(expectedLeaf);
  const decoded = chain.result.tableNames.map(value =>
    new crypto.X509Certificate(Buffer.from(value,'base64')));
  assert(decoded.some(certificate =>
    certificate.fingerprint256 === leaf.fingerprint256),
  'browser certificate chain omitted the presented TLS leaf');
  const integrity = JSON.parse(fs.readFileSync(
    path.join(capture,'evidence-integrity.json'),'utf8'));
  assert(integrity.artifacts.some(item => item.file === 'rest/' + cert.file &&
    item.status === 'saved' && item.sha256 === cert.sha256),
  'certificate payload was not recursively audited');
  assert(integrity.artifacts.some(item =>
    item.file === 'rest/security/index.json' && item.status === 'saved'),
  'security index integrity is missing');
  const wire = fs.readFileSync(path.join(capture,'cdp-wire.jsonl'),'utf8')
    .trim().split('\n').map(JSON.parse)
    .map(row => ({direction:row.direction,packet:JSON.parse(row.raw)}));
  assert(wire.some(row => row.direction === 'outbound' &&
    row.packet.method === 'Network.getCertificate' &&
    row.packet.params?.origin === origin),
  'real Chromium certificate query was not exercised');
  assert(!wire.some(row => row.direction === 'outbound' &&
    (row.packet.method?.startsWith('Security.') ||
      /^(Network|Page)\.(setBypassServiceWorker|setWebLifecycleState|setIgnoreCertificateErrors)$/
        .test(row.packet.method || ''))),
  'certificate acquisition used forbidden security overrides');
  const first = chain.result.tableNames[0].slice(0,32);
  for (const name of ['README.md','LIMITATIONS.md','NETWORK.md'])
  {
    const report = fs.readFileSync(path.join(capture,name),'utf8');
    assert(!report.includes(first),
      'human-readable report leaked raw certificate bytes: ' + name);
    assert(!report.includes('tls-secret-query-marker'),
      'human-readable report leaked full HTTPS query: ' + name);
  }
  const corrupt = Buffer.from(raw);
  corrupt[10] ^= 1;
  fs.writeFileSync(archive,corrupt);
  try
  {
    const audited = auditWebAnalyzeEvidence(capture);
    assert.equal(audited.status,'failed',
      'same-length certificate file corruption did not fail the audit');
    assert(audited.artifacts.some(item => item.file === 'rest/' + cert.file &&
      item.errorCode === 'evidence-sha256-mismatch'),
    'certificate corruption was not traced to the correct file');
  }
  finally {fs.writeFileSync(archive,raw);}
  assert(capabilities.protocol.domains.some(item =>
    item.name === 'Network' && item.commands.includes('getCertificate')));
}

async function main()
{
  const work = fs.mkdtempSync(path.join(os.tmpdir(),'web-analyze-tls-'));
  fs.chmodSync(work,0o700);
  let server;
  try
  {
    certificates(work);
    browserTrust(work);
    const cert = fs.readFileSync(path.join(work,'server.pem'));
    server = https.createServer({
      key:fs.readFileSync(path.join(work,'server.key')), cert
    },(request,response) =>
    {
      response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
      response.end('<!doctype html><title>TLS fixture</title>' +
        '<h1 id="tls-proof">trusted-https-evidence-fixture</h1>');
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const url = 'https://127.0.0.1:' + server.address().port +
      '/?token=tls-secret-query-marker';
    const env = {...process.env,
      m_ROOT:productRoot,m_LIB_DIR:path.join(productRoot,'lib')
    };
    const result = await run([url,path.join(work,'reports')],env);
    assert.equal(result.code,0,
      'real HTTPS analysis failed: ' + result.stderr);
    assert(result.stdout.trim().endsWith('/README.md'));
    const capture = path.dirname(result.stdout.trim());
    assert(fs.readFileSync(path.join(capture,
      'states/dom-rest-initial.html'),'utf8')
      .includes('trusted-https-evidence-fixture'),
    'browser did not load a trusted HTTPS document (certificate error?)');
    inspect(capture,url,cert);
  }
  finally
  {
    if(server)
    {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    fs.rmSync(work,{recursive:true,force:true,maxRetries:10,retryDelay:250});
  }
}
main().catch(error => {console.error(error);process.exitCode=1;});
