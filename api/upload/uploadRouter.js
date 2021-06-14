const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const AWS = require('aws-sdk');
const router = express.Router();
require('dotenv').config();
const authRequired = require('../middleware/authRequired');
const Cases = require('../cases/caseModel');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

const uploadFile = (fileName) => {
  const fileContent = fs.readFileSync(
    path.join(__dirname, `/uploads/${fileName}.pdf`)
  );

  const s3Upload = s3
    .upload({
      Bucket: process.env.AWS_BUCKET,
      Key: `${fileName}.pdf`,
      Body: fileContent,
    })
    .promise();

  return s3Upload
    .then((res) => {
      console.log(res);
      return res;
    })
    .catch((err) => {
      return err;
    });
};
router.use(
  fileUpload({
    useTempFiles: true,
    tempFileDir: path.join(__dirname, 'tmp'),
  })
);

router.post('/', authRequired, (req, res) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    res.status(400).send('No files were uploaded.');
  }
  // console.log(req.files);
  let targetFile = req.files.target_file;
  let UUID = uuidv4();
  targetFile.mv(path.join(__dirname, 'uploads', `${UUID}.pdf`), (err) => {
    if (err) {
      res.status(500).send(err);
    }
    uploadFile(UUID).then((s3return) => {
      console.log(s3return);
      fs.unlink(path.join(__dirname, 'uploads', `${UUID}.pdf`), (err) => {
        if (err) {
          res.status(500).send(err);
        }
      });
      const uploadedDate = new Date();
      const uploadedCase = {
        case_id: UUID,
        user_id: req.profile.user_id,
        url: s3return.Location,
        file_name: targetFile.name || '',
        status: 'Processing',
        uploaded: `${
          uploadedDate.getMonth() + 1
        }-${uploadedDate.getDate()}-${uploadedDate.getFullYear()}`,
      };
      Cases.add(uploadedCase)
        .then(() => {
          res.status(200).json({ id: UUID });
        })
        .catch((err) => {
          res.status(500).send(err);
        });
    });
  });
});

router.post('/scrap/:case_id', authRequired, (req, res) => {
  const UUID = req.params.case_id;
  axios
    .post(`${process.env.DS_API_URL}/pdf-ocr/${UUID}`)
    .then((scrape) => {
      console.log(scrape);
      const result = scrape.data.body;
      console.log('RESULT', result['check for one year'][0]);

      // let scrapedData = {};

      // for (const [k, v] of Object.entries(result)) {
      //   if (Array.isArray(v)) {
      //     if (k === 'application') {
      //       scrapedData['application_type'] = v;
      //     } else if (k === 'date') {
      //       scrapedData['case_date'] = new Date(v);
      //     } else if (k === 'outcome') {
      //       scrapedData['case_outcome'] = v;
      //     } else if (k === 'country of origin') {
      //       scrapedData['country_of_origin'] = v;
      //     } else if (k === 'panel members') {
      //       console.log(k);
      //     } else {
      //       scrapedData[k] = v[0];
      //     }
      //   } else if (typeof v === 'object') {
      //     scrapedData[k] = v[Object.keys(v)[0]];
      //   } else {
      //     if (k === 'state of origin') {
      //       scrapedData['case_origin_state'] = v;
      //     } else if (k === 'city of origin') {
      //       scrapedData['case_origin_city'] = v;
      //     } //else if (k === 'circuit of origin') {
      //     //   {
      //     //   }
      //     // }
      //     else {
      //       scrapedData[k] = v;
      //     }
      //   }
      // }

      console.log('---------------', scrapedData);

      const scrapedData = {
        date: new Date(result.date) || '',
        judge_id: 1,
        case_outcome: result.outcome[0] || '',
        country_of_origin: result['country of origin'] || '',
        protected_grounds: result['protected grounds'] || '',
        application_type: result.application[0],
        case_origin_city: result['city of origin'],
        case_origin_state: result['state of origin'],
        gender: result.gender[0] || '',
        applicant_language: result['applicant_language'][0],
        indigenous_group: result.indigenous[0],
        type_of_violence: result['based violence'][0] || '',
        appellate: false,
        filed_in_one_year: result['check for one year'][0] || false,
        credible: result.credibility[0],
      };
      Cases.changeStatus(UUID, 'Review')
        .then(() => {
          Cases.update(UUID, scrapedData)
            .then(() => {
              res.status(200).json({});
            })
            .catch((err) => {
              console.log(err);
              console.log(119);
              res.status(500).json(err);
            });
        })
        .catch((err) => {
          console.log(124);
          res.status(500).json(err);
        });
    })
    .catch((err) => {
      Cases.changeStatus(UUID, 'Error');
      res.status(500).json(err.message);
    });
});

router.post('/:case_id', authRequired, (req, res) => {
  const UUID = req.params.case_id;
  const uploadedCase = {
    date: req.body.date,
    outcome: req.body.outcome,
    country_of_origin: req.body.country_of_origin,
    protected_grounds: req.body.protected_grounds,
    application_type: req.body.application_type,
    case_origin_city: req.body.case_origin_city,
    case_origin_state: req.body.case_origin_state,
    gender: req.body.gender,
    applicant_language: req.body.applicant_language,
    indigenous_group: req.body.indigenous_group,
    type_of_violence: req.body.type_of_violence,
    appellate: req.body.appellate,
    filed_in_one_year: req.body.filed_in_one_year,
    credible: req.body.credible,
    status: 'Pending',
  };
  Cases.update(UUID, uploadedCase)
    .then(() => {
      res.status(200).json();
    })
    .catch((err) => {
      Cases.changeStatus(UUID, 'Error');
      res.status(500).json(err.message);
    });
});

module.exports = router;
