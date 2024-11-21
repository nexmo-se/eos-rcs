const processedFileHeader = [
  { id: 'ID', title: 'ID' },
  { id: 'EOSTEAMRUECKRUFNUMMER', title: 'EOSTEAMRUECKRUFNUMMER' },
  { id: 'ID_SMSTEXT', title: 'ID_SMSTEXT' },
  { id: 'ANREDE', title: 'ANREDE' },
  { id: 'NACHNAME', title: 'NACHNAME' },
  { id: 'VERPFLICHTUNGSNUMMER', title: 'VERPFLICHTUNGSNUMMER' },
  { id: 'MOBILTELEFONNUMMER', title: 'MOBILTELEFONNUMMER' },
  { id: 'EMAILADRESSE', title: 'EMAILADRESSE' },
  { id: 'FELD01', title: 'FELD01' },
  { id: 'FELD02', title: 'FELD02' },
  { id: 'FELD03', title: 'FELD03' },
  { id: 'FELD04', title: 'FELD04' },
  { id: 'FELD05', title: 'FELD05' },
  { id: 'FELD06', title: 'FELD06' },
  { id: 'FELD07', title: 'FELD07' },
  { id: 'FELD08', title: 'FELD08' },
  { id: 'FELD09', title: 'FELD09' },
  { id: 'FELD10', title: 'FELD10' },
];

const resultsHeader = [
  { id: 'id', title: 'id' },
  { id: 'to', title: 'to' },
  { id: 'message-id', title: 'message-id' },
  { id: 'status', title: 'status' },
];

const failedResultsHeader = [
  { id: 'client_ref', title: 'id' },
  { id: 'title', title: 'title' },
];

const failedHeader = [
  { id: 'failed', title: 'failed' },
  { id: 'successful', title: 'successful' },
  { id: 'startAt', title: 'startAt' },
  { id: 'endAt', title: 'endAt' },
  { id: 'smsSent', title: 'smsSent' },
  { id: 'rcsSent', title: 'rcsSent' },
  { id: 'blackList', title: 'blackList' },
];

module.exports = {
  resultsHeader,
  processedFileHeader,
  failedHeader,
  failedResultsHeader,
};
