import inquirer from "inquirer";
import fs from "fs";
import mssql from "mssql";
import mysql from "mysql2/promise";
import oracledb from "oracledb";
import pg from "pg";
import chalk from "chalk";
import { generateCSV, luhnChk } from "./helper";
import { ConnectionOptions } from "mysql2/typings/mysql";

export type ScanResult = Record<
  string,
  { headers: string[]; results: any[][] }
>;

// Still not working for oracle
const LIMIT = 1000;

const libPath = "./instant_oracle_client";
if (fs.existsSync(libPath)) {
  oracledb.initOracleClient({ libDir: libPath });
} else {
  console.log(
    chalk.yellow(
      "WARNING: Oracle Instant Client not found in the current directory. Please make sure the folder is named 'instant_oracle_client'. If you are using oracle, then the tool won't work."
    )
  );
}

const main = async () => {
  const answers = await inquirer.prompt({
    name: "database_type",
    type: "list",
    message: "Choose Database:\n",
    choices: ["My SQL", "Microsoft SQL", "Oracle", "Mongodb", "Postgresql"],
  });

  var matches: ScanResult;

  switch (answers.database_type) {
    case "My SQL": {
      const answers = await promptConnectionParams();

      matches = await mySQL({
        host: answers.hostname,
        user: answers.user,
        password: answers.password,
        database: answers.database,
        port: parseInt(answers.port) || 3306,
      });

      await generateCSV({
        data: matches,
        name: `${answers.hostname}-mysql`,
      });

      break;
    }
    case "Microsoft SQL": {
      const answers = await promptConnectionParams();
      const sqlConfig: mssql.config = {
        user: answers.user,
        password: answers.password,
        database: answers.database,
        server: answers.hostname,
        port: parseInt(answers.port) || 1433,
        options: {
          trustServerCertificate: true,
        },
      };

      matches = await microsoftSQL(sqlConfig);

      await generateCSV({ data: matches, name: `${answers.hostname}-mssql` });

      break;
    }
    case "Oracle": {
      console.log(
        chalk.yellowBright(
          "\n*\n*\n\nMake sure the the installed driver matches the database version and is in the current directory with folder name 'instant_oracle_client'\n\n*\n*\n"
        )
      );
      const inputMethod = await inquirer.prompt({
        name: "method",
        type: "list",
        message: "How would you like to connect:\n",
        choices: ["Default", "Connection String"],
      });

      const config: oracledb.ConnectionAttributes = {};
      var db = "";

      if (inputMethod.method === "Default") {
        const answers = await inquirer.prompt([
          { name: "hostname", type: "input", message: "Hostname: " },
          { name: "sid", type: "input", message: "SID: " },
          { name: "user", type: "input", message: "User: " },
          { name: "password", type: "password", message: "Password: " },
          { name: "database", type: "input", message: "Database Name: " },
          {
            name: "port",
            type: "input",
            message: "Port (Blank for Default): ",
          },
        ]);

        config["user"] = answers.user;
        config["password"] = answers.password;
        config["connectString"] = `(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(Host=${
          answers.hostname
        })(Port=${answers.port || 1521}))(CONNECT_DATA=(SID=${answers.sid})))`;
        db = answers.database;
      }
      if (inputMethod.method === "Connection String") {
        const answer = await inquirer.prompt({
          name: "connection_string",
          type: "input",
          message: "Connection String: ",
        });
        const auth = await inquirer.prompt([
          { name: "user", type: "input", message: "User: " },
          { name: "password", type: "password", message: "Password: " },
          { name: "database", type: "input", message: "Database Name: " },
        ]);
        config["connectionString"] = answer.connection_string;
        config["user"] = auth.user;
        config["password"] = auth.password;
        db = auth.database;
      }

      matches = await oracle(config, db);
      await generateCSV({ data: matches, name: `${db}-oracle` });
    }
    case "Mongodb": {
      // I still have to this :(
      break;
    }
    case "Postgresql": {
      const answers = await promptConnectionParams();

      matches = await postgres({
        host: answers.hostname,
        user: answers.user,
        password: answers.password,
        database: answers.database,
        port: parseInt(answers.port) || 5432,
      });

      await generateCSV({
        data: matches,
        name: `${answers.hostname}-postgresql`,
      });

      break;
    }
  }

  if (Object.keys(matches || {}).length > 0) {
    console.log(chalk.red("Credit Cards Detected"));
  } else {
    console.log(chalk.green("Scan Completed with no matches!"));
  }
  process.exit();
};

async function promptConnectionParams() {
  return await inquirer.prompt([
    { name: "hostname", type: "input", message: "Hostname: " },
    { name: "user", type: "input", message: "User: " },
    { name: "password", type: "password", message: "Password: " },
    { name: "database", type: "input", message: "Database Name: " },
    { name: "port", type: "input", message: "Port (Blank for Default): " },
  ]);
}

async function microsoftSQL(config: mssql.config): Promise<ScanResult> {
  try {
    // Connect
    const pool = await mssql.connect(config);
    console.log(chalk.greenBright("Connected!"));

    // Get Tables
    console.log(chalk.greenBright("Fetching Tables..."));
    const { recordset: result } = await pool
      .request()
      .query(`SELECT * FROM information_schema.tables;`);
    const tables = result.map(
      (table) => `${table.TABLE_SCHEMA}.${table.TABLE_NAME}`
    );

    console.log(tables);

    // Loop Over Tables
    console.log(chalk.greenBright("Looping Over Tables..."));
    let matches: ScanResult = {};
    for (var i = 0; i < tables.length; i++) {
      const table = tables[i];

      const { recordset: results } = await pool
        .request()
        .query(`SELECT TOP ${LIMIT} * FROM ${table} ORDER BY 1;`);

      const tableHeaders = Object.keys(results[0] || {});
      results.forEach((result) => {
        tableHeaders.forEach((header) => {
          if (result[header] === null || result[header] === undefined) return;
          const isCreditCard = luhnChk(result[header].toString().trim());
          if (isCreditCard) {
            if (!matches[table]) {
              matches[table] = {
                headers: tableHeaders,
                results: [Object.values(result)],
              };
            } else
              matches[table].results = [
                ...matches[table].results,
                Object.values(result),
              ];
          }
        });
      });
    }

    return matches;
  } catch (e) {
    console.log(e);
  }
}

async function mySQL(config: ConnectionOptions): Promise<ScanResult> {
  try {
    // Connect
    const connection = await mysql.createConnection(config);
    console.log(chalk.greenBright("Connected!"));

    // Get Tables
    console.log(chalk.greenBright("Fetching Tables..."));
    const [result] = await connection.execute<mysql.RowDataPacket[]>(
      "SHOW TABLES;"
    );
    const tables: string[] = result.map((res) => Object.values(res)[0]);

    // Loop Over Tables
    console.log(chalk.greenBright("Looping Over Tables..."));
    let matches: ScanResult = {};
    for (var i = 0; i < tables.length; i++) {
      const table = tables[i];
      const [results] = await connection.execute<mysql.RowDataPacket[]>(
        `SELECT * FROM ${table} LIMIT ${LIMIT};`
      );
      const tableHeaders = Object.keys(results[0] || {});
      results.forEach((result) => {
        tableHeaders.forEach((header) => {
          if (result[header] === null || result[header] === undefined) return;
          const isCreditCard = luhnChk(result[header].toString().trim());
          if (isCreditCard) {
            if (!matches[table]) {
              matches[table] = {
                headers: tableHeaders,
                results: [Object.values(result)],
              };
            } else
              matches[table].results = [
                ...matches[table].results,
                Object.values(result),
              ];
          }
        });
      });
    }

    return matches;
  } catch (e) {
    console.log(e);
  }
}

async function oracle(
  config: oracledb.ConnectionAttributes,
  dbName: string
): Promise<ScanResult> {
  const connection = await oracledb.getConnection(config);
  console.log(chalk.greenBright("Connected!"));

  console.log(chalk.greenBright("Fetching Tables..."));
  const result = await connection.execute(
    `SELECT table_name from all_tables WHERE owner=:owner`,
    [dbName.toUpperCase()]
  );

  const tables = result.rows.map((r) => r[0]);

  console.log(chalk.greenBright("Looping Over Tables..."));
  let matches: ScanResult = {};
  for (var i = 0; i < tables.length; i++) {
    const table = tables[i];
    const result = await connection.execute(`SELECT * FROM ${table}`);
    const tableHeaders = result.metaData.map((r) => r.name);
    result.rows.forEach((row) => {
      tableHeaders.forEach((_, idx) => {
        if (row[idx] === null || row[idx] === undefined) return;
        const isCreditCard = luhnChk(row[idx].toString().trim());
        if (isCreditCard) {
          if (!matches[table]) {
            matches[table] = {
              headers: tableHeaders,
              results: [row as any[]],
            };
          } else
            matches[table].results = [...matches[table].results, row as any[]];
        }
      });
    });
  }

  return matches;
}

async function postgres(config: pg.ClientConfig): Promise<ScanResult> {
  const pool = new pg.Pool(config);
  const client = await pool.connect();
  console.log(chalk.greenBright("Connected!"));

  console.log(chalk.greenBright("Fetching Tables..."));
  const result = await client.query(
    `SELECT table_name from information_schema.tables WHERE table_schema='public'`
  );

  const tables = result.rows.map((r) => r.table_name);

  console.log(chalk.greenBright("Looping Over Tables..."));
  let matches: ScanResult = {};
  for (var i = 0; i < tables.length; i++) {
    const table = tables[i];
    const result = await client.query(
      `SELECT * FROM "${table}" LIMIT ${LIMIT}`
    );
    const tableHeaders = result.fields.map((r) => r.name);
    result.rows.forEach((row) => {
      tableHeaders.forEach((h) => {
        if (row[h] === null || row[h] === undefined) return;
        const isCreditCard = luhnChk(row[h].toString().trim());
        if (isCreditCard) {
          if (!matches[table]) {
            matches[table] = {
              headers: tableHeaders,
              results: [Object.values(row)],
            };
          } else matches[table].results.push([Object.values(row)]);
        }
      });
    });
  }

  return matches;
}

main();
