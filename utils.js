const { DateTime } = require('luxon');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const checkSenderIdValid = (senderId) => /^[a-zA-Z0-9]*$/gm.test(senderId);
const { tokenGenerate } = require('@vonage/jwt');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');

const constants = require('./constants');

const privateKey = process.env.VCR_PRIVATE_KEY;
const applicationId = process.env.VCR_API_APPLICATION_ID;
const rcsAgent = 'EOS';

const secondsTillEndOfDay = () => {
  const now = DateTime.now().setZone('Europe/Berlin');
  const germanTime = DateTime.fromObject({ day: now.c.day, hour: 20, minute: 0, second: 0 }, { zone: 'Europe/Berlin' });
  const diffSeconds = parseInt((germanTime - now) / 1000);
  return diffSeconds;
};
const timeNow = () => {
  const now = DateTime.now().setZone('Europe/Berlin');
  return now.c.hour;
};

const generateToken = () => {
  return tokenGenerate(applicationId, privateKey, {
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60, // 8 hours
  });
};
const checkRCS = async (to) => {
  const host = 'https://api.nexmo.com';
  const token = generateToken();

  const response = await fetch(`${host}/v1/channel-manager/rcs/agents/${rcsAgent}/google/phones/${to}/capabilities`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (response.ok) {
    return true;
  }

  return false;
};

const writeResults = async (results, path, header) => {
  const csvWriter = createCsvWriter({
    fieldDelimiter: ';',
    path: path,
    header: header,
  });
  // if (results.length) {
  csvWriter
    .writeRecords(results) // returns a promise
    .then(() => {
      console.log('...Done');
    })
    .catch((e) => console.log(`Something wrong while writting the output csv ${e}`));
};

const moveFile = (assets, pathFrom, pathTo, records, filename) => {
  return new Promise(async (res, rej) => {
    try {
      await writeResults(records, pathFrom, constants.processedFileHeader);
      console.log('uploading file to processed folder');

      await assets.uploadFiles([pathFrom], pathTo).execute();
      console.log('removing file from send folder' + filename);
      await assets.remove(filename).execute();
      res();
    } catch (e) {
      console.log(`Something wrong while moving the csv file ${e}`);
      rej(e);
    }
  });
};

// function checkAuthenticated(req, res, next) {
//   if (req.isAuthenticated()) {
//     return next();
//   }

//   res.redirect('/login');
// }

const checkAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }

  res.redirect('/login');
};

const checkNotAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return res.redirect('/templates/new');
  }
  next();
};

module.exports = {
  checkSenderIdValid,
  secondsTillEndOfDay,
  writeResults,
  moveFile,
  checkAuthenticated,
  checkNotAuthenticated,
  timeNow,
  checkRCS,
  generateToken,
  rcsAgent,
};
