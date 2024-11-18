Neru EOS sample app

## Pre-Requisites

1. Install NodeJS
2. Install [Neru CLI](https://vonage-neru.herokuapp.com/neru/overview)

## Installation

1. Run `npm install`
2. Run `neru configure` where you will be asked to set apikey and secret (Nexmo).
3. Create a `neru.yml` file as per `neru.sample.yml`

Next step is to configure the **appid** on Neru:

```
neru app configure --app-id your-app-id

```

## Starting the app

POST to `/scheduler` with {"command": "start", "maxInvocations": number}

This will start a cron job that runs every minute for 3 minutes (this is for testing purposes and needs to be changed for production)

This scheduler will call the `/checkandsend`endpoint which will check if there are csv files that need to be processed. If there are files that need to be processed, the file will be read, SMS sent and a new CSV file will be created on `/output` directory containing the results of the SMS sending.

## Stopping the app

POST to `/scheduler` with {"command": "stop"}

## Debug

To debug the service, you can run `neru debug`.
