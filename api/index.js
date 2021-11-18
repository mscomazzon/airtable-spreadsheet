let axios = require("axios");

require("dotenv").config();
const {
  AIRTABLE_API_KEY,
  COHORT,
  SPREADSHEET_ID,
  CANT_GROUPS,
  STUDENTS_AIRTABLE,
} = process.env;

const { google } = require("googleapis");

const ObjectsToCsv = require("objects-to-csv");

const Airtable = require("airtable");
Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: AIRTABLE_API_KEY,
});
const students_table = Airtable.base(STUDENTS_AIRTABLE);
let students = [];

async function getSpreadSheet() {
  let data = [];

  const auth = new google.auth.GoogleAuth({
    keyFile: "sheet-credentials.json",
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });

  // Create client instance
  const client = await auth.getClient();

  // Instance of GoogleSheet
  const googleSheets = google.sheets({ version: "v4", auth: client });

  // Read columns from spreadsheet
  for (let i = 1; i <= CANT_GROUPS; i++) {
    const getColumns = await googleSheets.spreadsheets.values.get({
      auth,
      spreadsheetId: SPREADSHEET_ID,
      majorDimension: "COLUMNS",
      // nombre del tab, me da la columna A
      range: `Group ${i}`,
    });
    /*todo:
      encontrar el indice en donde esta Nombre y Apellido y evaluar de ahi para abajo
    *  seria mas correcto*/
    let students = getColumns.data.values[0].slice(5);
    let points = getColumns.data.values[46].slice(5);
    let comments = getColumns.data.values[47].slice(5);
    for (let j = 0; j < students.length; j++) {
      data.push({
        student: students[j],
        points: points[j] ? points[j] : "",
        comments: comments[j] ? comments[j] : "",
      });
    }
  }

  return data;
}

students_table("Alumno")
  .select({
    view: COHORT,
    filterByFormula: `AND({Status} = "Regular", {Last Checkpoint}="M3")`,
    fields: [
      "Nombre y Apellido",
      "Sexo",
      "GRUPO COHORTE",
      "GitHub",
      "CustomerID",
    ],
  })
  .eachPage(
    function page(records, fetchNextPage) {
      records.forEach(function (record) {
        students.push({
          name: record.get("Nombre y Apellido"),
          gender: record.get("Sexo"),
          group: record.get("GRUPO COHORTE"),
          github: record.get("GitHub"),
          email: record.get("CustomerID"),
        });
      });
      fetchNextPage();
    },
    function done(err) {
      if (err) {
        console.error(err);
        return;
      }

      getSpreadSheet()
        .then(async (spreadsheet) => {
          spreadsheet.forEach((ss) => {
            students = students.map((s) => {
              if (s.name === ss.student) {
                s.ta_points = ss.points;
                s.ta_comments = ss.comments;
              }
              return s;
            });
          });
          let responses = await axios.get(
            `https://learning.soyhenry.com/toolbox/checkpoint-report/peer-review-cp/results/web${COHORT.toLowerCase()}`
          );

          responses.data.rows.forEach((r) => {
            students = students.map((s) => {
              if (s.name === r.name) {
                s.points = r.score;
                s.TA = r.ta ? true : false;
                s.HH = r.hh ? true : false;
              }
              return s;
            });
          });

          return students;
        })
        .then(async (final) => {
          const csv = new ObjectsToCsv(final);

          await csv.toDisk("../csv/download.csv");
        })
        .catch((e) => console.error(e));
    }
  );
