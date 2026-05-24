import { runCommand, exitOnFailure } from '../util/run.js';
import { requireDbConfig } from '../util/config.js';

function psqlExec(sql) {
  const db = requireDbConfig();
  return runCommand('docker', [
    'exec',
    db.container,
    'psql',
    '-U',
    db.user,
    '-d',
    db.name,
    '-c',
    sql,
  ]);
}

function psqlShell() {
  const db = requireDbConfig();
  return runCommand(
    'docker',
    ['exec', '-it', db.container, 'psql', '-U', db.user, '-d', db.name],
    { stdio: 'inherit' },
  );
}

export function registerDb(cli) {
  cli
    .command('db:list-tables', 'List tables in the dev database')
    .action(() => exitOnFailure(psqlExec('\\dt')));

  cli
    .command('db:describe <table>', 'Describe a table')
    .action((table) => exitOnFailure(psqlExec(`\\d ${table}`)));

  cli
    .command('db:count <table>', 'Count rows in a table')
    .action((table) => exitOnFailure(psqlExec(`SELECT COUNT(*) FROM ${table};`)));

  cli
    .command('db:truncate <table>', 'Truncate a table (with CASCADE)')
    .action((table) => exitOnFailure(psqlExec(`TRUNCATE TABLE ${table} CASCADE;`)));

  cli
    .command('db:psql', 'Open an interactive psql shell against the dev database')
    .action(() => exitOnFailure(psqlShell()));
}
