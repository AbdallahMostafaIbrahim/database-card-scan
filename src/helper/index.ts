import path from "path";
import fs from "fs";
import { createArrayCsvWriter } from "csv-writer";
import { ScanResult } from "..";
import chalk from "chalk";

export const generateCSV = async ({
  data,
  name,
}: {
  data: ScanResult;
  name: string;
}) => {
  var dir = path.join(process.cwd(), `/Reports/${name}-${Date.now()}/`);
  fs.mkdirSync(dir, { recursive: true });

  console.log(chalk.greenBright("Generating Output..."));

  for (const table in data) {
    const csvWriter = createArrayCsvWriter({
      path: path.join(dir, `${table}.csv`),
      header: data[table].headers,
    });
    await csvWriter.writeRecords(data[table].results);
  }
};

export const deleteConnectionFolder = async (data) => {
  try {
    await fs.promises.rmdir(
      __dirname + `/../../Reports/${data.host}-${data.id}/`,
      {
        recursive: true,
      }
    );
  } catch {}
};

export const luhnChk = (function (arr) {
  return function (ccNum) {
    if (ccNum.length <= 13 || ccNum.length >= 19) {
      return false;
    }
    var len = ccNum.length,
      bit = 1,
      sum = 0,
      val;

    while (len) {
      val = parseInt(ccNum.charAt(--len), 10);
      sum += (bit ^= 1) ? arr[val] : val;
    }

    return sum && sum % 10 === 0;
  };
})([0, 2, 4, 6, 8, 1, 3, 5, 7, 9]);
