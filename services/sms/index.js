// eslint-disable-next-line no-control-regex

const TEMPLATES_TABLENAME = 'TEMPLATES'
const axios = require('axios')
const PROCESSEDFILES_TABLENAME = 'processedfiles'
// column name of csv file that contains the template ID
const CSV_TEMPLATE_ID_COLUMN_NAME = 'ID_SMSTEXT'
// column name of csv file that contains the phone number of the receiver
const CSV_PHONE_NUMBER_COLUMN_NAME = 'MOBILTELEFONNUMMER'
// column name of csv file that contains the ID that will be put into account_ref (together with csv filename)
const CSV_ID_COLUMN_NAME = 'ID'
// column name of csv file that contains the ID that will be put in the client_ref field
const CSV_CLIENT_REF_COLUMN_NAME = 'VERPFLICHTUNGSNUMMER'
const isUnicode = (text) => /[^\u0000-\u00ff]/.test(text)
const rateLimiterService = require('../rateLimiter/index')
const tps = parseInt(process.env.tps || '30', 10)
const rateLimitAxios = rateLimiterService.newInstance(tps)
const utils = require('../../utils')
const blackListService = require('../blacklist/index')
// vcr tablename for processed filenames
const { vcr, State } = require('@vonage/vcr-sdk')
const apikey = process.env.apikey
const apiSecret = process.env.apiSecret
const api_url = 'https://api.nexmo.com/v1/messages'
const session = vcr.getGlobalSession()
const globalState = new State(session, `application:f5897b48-9fab-4297-afb5-504d3b9c3296`)

const Bottleneck = require('bottleneck')
const { v4: uuidv4 } = require('uuid')

// RCS check (bulk)
//  => Returns array with string of RCS supported numbers
const getRCSSupportedNumbers = async (records) => {
  const token = utils.generateToken()
  // console.log(`getRCSSupportedNumbers / token: ${token}`);

  const users = records.map((record) => { return `${record[CSV_PHONE_NUMBER_COLUMN_NAME]?.replaceAll('+', '')}`; });
  let rcsSupportedNumbers = [];
  for (let i = 0; i < users.length; i = i + 999) {
    const usersToCheck = users.slice(i, i + 999);
    // console.log(`usersToCheck.length: ${usersToCheck.length}`);

    if (usersToCheck.length > 500) {
      const resultNumbers = await utils.checkRCSBulk(usersToCheck, token, rateLimitAxios)
      rcsSupportedNumbers = rcsSupportedNumbers.concat(resultNumbers);
      // console.log(`[1] rcsSupportedNumbers array length: ${rcsSupportedNumbers.length}`);
    } else {
      // console.log(`The rest of data is less than 500. Performing single checks now`);
      let resultNumbers = [];
      for (let j = i; j < usersToCheck.length; j++) {
        const isRCSSupported = await utils.checkRCS(usersToCheck[j], token, rateLimitAxios)
        if (isRCSSupported) resultNumbers.push(`+${usersToCheck[j]}`);
      }
      rcsSupportedNumbers = rcsSupportedNumbers.concat(resultNumbers);
      // console.log(`[2] rcsSupportedNumbers array length: ${rcsSupportedNumbers.length}`);

      i = users.length;
    }
  }
  console.log(`final rcsSupportedNumbers array created: ${rcsSupportedNumbers.length}`);
  return Promise.resolve(rcsSupportedNumbers)
}

// V2.5 - Uses Bulk + Individual RCS check depending on the number of records
const sendAllMessages = async (records, filename) => {
  const csvName = filename.split('send/')[1]
  const templates = await globalState.mapGetAll(TEMPLATES_TABLENAME)
  const parsedTemplates = Object.keys(templates).map((key) => {
    const data = JSON.parse(templates[key])
    return { ...data }
  })

  try {
    let smsCount = 0
    let rcsCount = 0
    let blackListed = 0

    const rcsSupportedNumbers = await getRCSSupportedNumbers(records);

    const limiter = new Bottleneck({
      maxConcurrent: 1000,
      minTime: 25
    });

    const wrapLimiter = async (record, i) => {
      const wrapped = limiter.wrap(processARecord);
      return await wrapped(record, i).then((result) => {
        return Promise.resolve(result);
      });
    };
    
    const processARecord = async (record, i) => {
      try {
        if (i % 1000 === 0) console.log("Processing record ", i, " / ", JSON.stringify(record))

        const template = parsedTemplates.find((template) => template.id === record[CSV_TEMPLATE_ID_COLUMN_NAME])
        let text = template?.text
        const rcsTemplate = template?.rcsEnabled
  
        const senderNumber = `${record[`${template?.senderIdField}`]?.replaceAll('+', '')}`
        const to = `${record[CSV_PHONE_NUMBER_COLUMN_NAME]?.replaceAll('+', '')}`
        const client_ref = record[CSV_ID_COLUMN_NAME]
  
        const regexp = /\{\{\s?([\w\d]+)\s?\}\}/g
        if (text) {
          const matchArrays = [...text.matchAll(regexp)]
          matchArrays.forEach((array) => {
            text = text.replaceAll(array[0], record[`${array[1]}`])
          })
        }
  
        const client_ref_obj = { client_ref: client_ref }
        const isRcsSupported = rcsTemplate ? rcsSupportedNumbers.includes(`+${to}`) : false;
  
        const result = await sendSmsOrRcs(senderNumber, to, text, api_url, client_ref, csvName, rateLimitAxios, rcsTemplate, isRcsSupported)
        // if (i % 1000 === 0) console.log("sendSmsOrRcs result ", i, " / ", JSON.stringify(result))

        // Increment SMS or RCS count based on the channel
        if (result.channel === 'sms') smsCount++
        if (result.channel === 'rcs') rcsCount++
        if (result.channel === 'blacklist') blackListed++
  
        // console.log(`\nFinished processing record index | ${i}`);
        return Promise.resolve(Object.assign({}, result, client_ref_obj))
      } catch (error) {
        return Promise.reject(error)
      }
    };

    const promises = records.map(wrapLimiter);
    const limiterResult = await Promise.all(promises);

    // Add SMS and RCS counts to results summary
    console.log(`count result | smsCount: ${smsCount} | rcsCount: ${rcsCount} | blackListed: ${blackListed}`);
    limiterResult.push({ smsCount, rcsCount, blackListed })

    return limiterResult;
  } catch (error) {
    console.error(error)
    return error
  }
}

const sendOptOutRcs = async (senderNumber, to) => {
  const headers = {
    Authorization: `Bearer ${utils.generateToken()}`, // Use the JWT token parameter
    'Content-Type': 'application/json',
  }
  const body = {
    message_type: 'text',
    from: senderNumber,
    channel: 'rcs',
    to: to,
    text: 'Sie haben sich erfolgreich abgemeldet und werden keine RCS Nachrichten mehr zu diesem Vorgang erhalten.',
    sms: { encoding_type: 'auto' },
    client_ref: `opt-out`,
  }
  try {
    const response = await axios.post(api_url, body, { headers })
    return {
      ...response.data,
      // Include the channel in the returned object
    }
  } catch (error) {
    console.error(error.response.data)
    return { ...error.response.data, channel }
    // return Promise.reject(error);
  }
}

const sendSmsOrRcs = async (senderNumber, to, text, apiUrl, campaignName, csvName, axios, rcsTemplate, isRcsSupported) => {
  let channel = 'sms' // Default channel is SMS
  let from = senderNumber || 'test'
  const headers = {
    Authorization: `Bearer ${utils.generateToken()}`, // Use the JWT token parameter
    'Content-Type': 'application/json',
  }

  if (rcsTemplate) {
    channel = isRcsSupported ? 'rcs' : 'sms'
    from = isRcsSupported ? utils.rcsAgent : from
  }

  const body = {
    message_type: 'text',
    from: from,
    channel: channel,
    to: to,
    text: text,
    sms: { encoding_type: 'auto' },
    client_ref: `${campaignName}-${csvName}`,
  }
  // console.log(`body: ${JSON.stringify(body)}`)
  const isBlackListed = await blackListService.isBlackListed(to)
  if (isBlackListed) {
    console.log(`Exception - ${to} is blackListed`)
    return {
      message_id: 'Blacklisted number - User sent STOP',
      channel: 'blacklist',
    }
  }

  if (isRcsSupported) console.log(`RCS message will be sent to number ${to} with client_ref ${campaignName}-${csvName}`)

  try {
    const response = await axios.post(apiUrl, body, { headers })
    return {
      ...response.data,
      // message_uuid: uuidv4(),
      channel, // Include the channel in the returned object
    }
  } catch (error) {
    console.error(error.response.data)
    if (error.response != null && error.response.status === 429) {
      console.log('Too many requests (429), retrying...')
      // return sendSmsOrRcs(to, text, apiUrl, campaignName, csvName, axios, rcsTemplate);
    }
    return { ...error.response.data, channel }
    // return Promise.reject(error);
  }
}

module.exports = {
  sendSmsOrRcs,
  sendAllMessages,
  sendOptOutRcs,
}
