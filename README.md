VCR EOS sample app

## Pre-Requisites

1. Install NodeJS
2. Install [VCR CLI](https://developer.vonage.com/en/vonage-cloud-runtime/getting-started/working-locally?source=vonage-cloud-runtime)

## Installation

1. Run `npm install`
2. Run `vcr configure` where you will be asked to set apikey and secret (Nexmo).
3. Create a `vcr.yml` file as per `vcr.sample.yml`

Next step is to configure the **appid** on VCR:

```
vcr app configure --app-id your-app-id

```

## Starting the app

POST to `/scheduler` with {"command": "start", "maxInvocations": number}

This will start a cron job that runs every minute for 3 minutes (this is for testing purposes and needs to be changed for production)

This scheduler will call the `/checkandsend`endpoint which will check if there are csv files that need to be processed. If there are files that need to be processed, the file will be read, SMS sent and a new CSV file will be created on `/output` directory containing the results of the SMS sending.

## Stopping the app

POST to `/scheduler` with {"command": "stop"}

## Debug

To debug the service, you can run `vcr debug`.
