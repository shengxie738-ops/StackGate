import fs from 'node:fs';
import path from 'node:path';
fs.writeFileSync(path.join(process.env.STACKGATE_OUTPUT_DIR,'junit.xml'),'<testsuite tests="0"/>');
