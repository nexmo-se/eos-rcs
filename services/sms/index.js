// eslint-disable-next-line no-control-regex

const TEMPLATES_TABLENAME = 'TEMPLATES';
const axios = require('axios');
const PROCESSEDFILES_TABLENAME = 'processedfiles';
// column name of csv file that contains the template ID
const CSV_TEMPLATE_ID_COLUMN_NAME = 'ID_SMSTEXT';
// column name of csv file that contains the phone number of the receiver
const CSV_PHONE_NUMBER_COLUMN_NAME = 'MOBILTELEFONNUMMER';
// column name of csv file that contains the ID that will be put into account_ref (together with csv filename)
const CSV_ID_COLUMN_NAME = 'ID';
// column name of csv file that contains the ID that will be put in the client_ref field
const CSV_CLIENT_REF_COLUMN_NAME = 'VERPFLICHTUNGSNUMMER';
const isUnicode = (text) => /[^\u0000-\u00ff]/.test(text);
const rateLimiterService = require('../rateLimiter/index');
const tps = parseInt(process.env.tps || '30', 10);
const rateLimitAxios = rateLimiterService.newInstance(tps);
const utils = require('../../utils');
// neru tablename for processed filenames
const { neru, Assets, Scheduler } = require('neru-alpha');
const apikey = process.env.apikey;
const apiSecret = process.env.apiSecret;
const api_url = 'https://api.nexmo.com/v1/messages';
const globalState = neru.getGlobalState();

const sendAllMessages = async (records, filename) => {
  const csvName = filename.split('send/')[1];
  const templates = await globalState.hgetall(TEMPLATES_TABLENAME);
  const parsedTemplates = Object.keys(templates).map((key) => {
    const data = JSON.parse(templates[key]);
    return { ...data };
  });

  try {
    const promises = records.map(async (record) => {
      try {
        const template = parsedTemplates.find((template) => template.id === record[CSV_TEMPLATE_ID_COLUMN_NAME]);
        let text = template?.text;
        const rcsTemplate = template?.rcsEnabled;

        const senderNumber = `${record[`${template?.senderIdField}`]?.replaceAll('+', '')}`;

        const to = `${record[CSV_PHONE_NUMBER_COLUMN_NAME]?.replaceAll('+', '')}`;
        const client_ref = record[CSV_ID_COLUMN_NAME];

        const regexp = /\{\{\s?([\w\d]+)\s?\}\}/g;
        if (text) {
          // now, find all placeholders in the template text by using the regex above
          const matchArrays = [...text.matchAll(regexp)];
          // for each placeholder, replace it with the value of the csv column that it references
          matchArrays.forEach((array) => {
            text = text.replaceAll(array[0], record[`${array[1]}`]);
          });
        }

        const client_ref_obj = { client_ref: client_ref };
        // Add to queue

        const result = await sendSmsOrRcs(to, text, api_url, client_ref, csvName, rateLimitAxios, rcsTemplate);
        console.log(result);
        return Promise.resolve(Object.assign({}, result, client_ref_obj));
      } catch (error) {
        return Promise.reject(error);
      }
    });
    const results = await Promise.all(promises);
    return results;
  } catch (error) {
    console.error(error);
    return error;
  }
};

const sendSmsOrRcs = async (to, text, apiUrl, campaignName, csvName, axios, rcsTemplate) => {
  // Determine proper type to send as
  let channel = 'sms';
  let from = 'test';
  const headers = {
    Authorization: `Bearer ${utils.generateToken()}`, // Use the JWT token parameter
    'Content-Type': 'application/json',
  };
  if (rcsTemplate) {
    const isRcsSupported = await utils.checkRCS(to);
    channel = isRcsSupported ? 'rcs' : 'sms';
    from = isRcsSupported ? utils.rcsAgent : from;
  }

  // Constructing the API Request Body
  const body = {
    message_type: 'text',
    from: from,
    channel: channel,
    to: to,
    text: text,
    sms: { encoding_type: 'auto' },
    client_ref: `${campaignName}-${csvName}`,
  };

  return axios
    .post(apiUrl, body, { headers })
    .then((response) => {
      const { data } = response;
      return Promise.resolve(data);
    })
    .catch((error) => {
      console.log(error);
      // Check for 429: Too Many Requests
      if (error.response != null && error.response.status === 429) {
        console.log('Too many request (429) detected, put back into queue');

        // Recursively call self, to put request back into queue
        return sendSmsOrRcs(to, text, channel, apiUrl, campaignName, csvName, axios, rcsTemplate);
      }

      console.error(error.message);
      console.error(error);
      return Promise.reject(error);
    });
};

module.exports = {
  sendSmsOrRcs,
  sendAllMessages,
};
