require("dotenv").config();
const {
  AIRTABLE_API_KEY,
  COHORT,
  COHORT_TA,
  SPREADSHEET_ID,
  CANT_GROUPS,
  STUDENTS_AIRTABLE,
  TA_FORM_AIRTABLE,
} = process.env;

const { google } = require("googleapis");

const ObjectsToCsv = require("objects-to-csv");

const Airtable = require("airtable");
Airtable.configure({
  endpointUrl: "https://api.airtable.com",
  apiKey: AIRTABLE_API_KEY,
});
const students_table = Airtable.base(STUDENTS_AIRTABLE);
const ta_table = Airtable.base(TA_FORM_AIRTABLE);
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
      // This function (`page`) will get called for each page of records.

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

      ta_table(COHORT_TA)
        .select({
          view: "Respuestas",
          fields: [
            "Nombre y Apellido",
            "Motivacion",
            "Intencion",
            "Razon",
            "Feedback - Ideas",
            "Feedback - Tareas",
            "Importancia",
          ],
        })
        .eachPage(
          function page(records, fetchNextPage) {
            records.forEach(function (record) {
              students = students.map((s) => {
                if (s.name === record.get("Nombre y Apellido")) {
                  s.motivation = record.get("Motivacion");
                  console.log(record.get("Intencion"));
                  if (record.get("Intencion") === "sólo HH") {
                    s.HH = 1;
                    s.TA = 0;
                  } else if (record.get("Intencion") === "sólo TA") {
                    s.TA = 1;
                    s.HH = 0;
                  } else if (record.get("Intencion") === "Ninguno") {
                    s.TA = 0;
                    s.HH = 0;
                  } else {
                    s.TA = 1;
                    s.HH = 1;
                  }
                  s.reason = record.get("Razon");
                  s.ideas_feedback = record.get("Feedback - Ideas");
                  s.homework_feedback = record.get("Feedback - Tareas");
                  s.importance = record.get("Importancia");
                }
                return s;
              });
            });
            fetchNextPage();
          },
          async function done(err) {
            if (err) {
              console.error(err);
              return;
            }
            students = students.map((s) => {
              if (!s.hasOwnProperty("motivation")) {
                s.motivation = "";
                s.TA = 0;
                s.HH = 0;
                s.reason = "";
                s.ideas_feedback = "";
                s.homework_feedback = "";
                s.importance = "";
              }
              return s;
            });

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
                return students;
              })
              .then(async (final) => {
                const csv = new ObjectsToCsv(final);

                await csv.toDisk("../csv/download.csv");
              });
          }
        );
    }
  );
