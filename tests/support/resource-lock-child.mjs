import {pathToFileURL} from 'node:url';
const {acquireResources}=await import(pathToFileURL(process.argv[2]).href);
const lease=await acquireResources(['workspace_shared'],JSON.parse(process.argv[3]));
if(lease)await lease.release();
process.stdout.write(JSON.stringify({acquired:!!lease}));
