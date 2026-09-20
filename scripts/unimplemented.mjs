console.error(`Unimplemented check entry: ${process.argv[2] ?? 'unknown'}; scheduled in ${process.argv[3] ?? 'a later task'}. NOT VERIFIED.`);
process.exitCode = 2;
