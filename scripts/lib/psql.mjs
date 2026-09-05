// VORA — enveloppe autour du client psql local. Aucune dépendance npm :
// ces scripts doivent tourner avant `npm install`, et sur les trois systèmes de l'équipe.

import { spawnSync } from 'node:child_process';

export const isWindows = process.platform === 'win32';

/** Le binaire `psql` est-il dans le PATH ? */
export function hasPsql() {
  const probe = spawnSync('psql', ['--version'], { encoding: 'utf8', shell: isWindows });
  return probe.status === 0;
}

/**
 * Exécute une commande psql.
 * @param {{host,port,user,password,database}} conn
 * @param {string[]} args arguments supplémentaires (-c, -f, …)
 * @param {{admin?: boolean, silent?: boolean}} options
 *        admin : passe par `sudo -u postgres` sous Linux/macOS (création de rôle, extensions)
 */
export function psql(conn, args, options = {}) {
  const base = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '-v', 'ON_ERROR_STOP=1',
    '-X', // ignore le ~/.psqlrc de la machine
    ...args,
  ];

  const command = options.admin && !isWindows ? 'sudo' : 'psql';
  const commandArgs = options.admin && !isWindows ? ['-n', '-u', 'postgres', 'psql', ...base] : base;

  return spawnSync(command, commandArgs, {
    encoding: 'utf8',
    shell: isWindows,
    env: { ...process.env, PGPASSWORD: conn.password, PGCONNECT_TIMEOUT: '5' },
    stdio: options.silent ? 'pipe' : ['ignore', 'pipe', 'pipe'],
  });
}

/** Exécute une requête et renvoie sa sortie brute, ou null si la commande échoue. */
export function query(conn, sql, options = {}) {
  const result = psql(conn, ['-tAc', sql], { silent: true, ...options });
  return result.status === 0 ? result.stdout.trim() : null;
}

/** Le serveur PostgreSQL répond-il sur ce hôte/port ? */
export function serverIsUp(conn) {
  const ready = spawnSync('pg_isready', ['-h', conn.host, '-p', String(conn.port)], {
    encoding: 'utf8',
    shell: isWindows,
  });
  if (ready.status === 0) return true;
  if (ready.error) {
    // pg_isready absent du PATH : on retombe sur une connexion psql à la base `postgres`.
    return query({ ...conn, database: 'postgres' }, 'select 1') !== null;
  }
  return false;
}

/** Instructions de démarrage du service, propres au système de l'utilisateur. */
export function startServerHint() {
  if (process.platform === 'linux') {
    return [
      'sudo systemctl start postgresql',
      "puis, pour qu'il démarre avec la machine : sudo systemctl enable postgresql",
    ];
  }
  if (process.platform === 'darwin') {
    return ['brew services start postgresql@16'];
  }
  return [
    'PowerShell en administrateur : net start postgresql-x64-16',
    'ou : Services → PostgreSQL Server 16 → Démarrer',
  ];
}
