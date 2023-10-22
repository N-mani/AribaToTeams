// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

const {
    TeamsActivityHandler,
    CardFactory,
} = require('botbuilder');

const {
} = require('botbuilder-core')

const axios = require('axios');

class TeamsMessagingExtensionsSearchAuthConfigBot extends TeamsActivityHandler {
    /**
     *
     * @param {UserState} User state to persist configuration settings
     */
    constructor(userState) {
        super();
        this.connectionName = process.env.ConnectionName;
        this.userState = userState;
    }

    /**
     * Override the ActivityHandler.run() method to save state changes after the bot logic completes.
     */
    async run(context) {
        await super.run(context);

        // Save state changes
        await this.userState.saveChanges(context);
    }

    // Overloaded function. Receives invoke activities with the name 'composeExtension/query'.
    async handleTeamsMessagingExtensionQuery(context, query) {
        const searchQuery = query.parameters[0].value;
        const attachments = [];

        // When the Bot Service Auth flow completes, the query.State will contain a magic code used for verification.
        const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey);
        const magicCode =
            context.state && Number.isInteger(Number(context.state))
                ? context.state
                : '';

        const tokenResponse = await userTokenClient.getUserToken(
            context.activity.from.id,
            this.connectionName,
            context.activity.channelId,
            magicCode
        );

        if (!tokenResponse || !tokenResponse.token) {
            // There is no token, so the user has not signed in yet.
            // Retrieve the OAuth Sign in Link to use in the MessagingExtensionResult Suggested Actions
            const { signInLink } = await userTokenClient.getSignInResource(
                this.connectionName,
                context.activity
            );

            return {
                composeExtension: {
                    type: 'silentAuth',
                    suggestedActions: {
                        actions: [
                            {
                                type: 'openUrl',
                                value: signInLink,
                                title: 'Bot Service OAuth'
                            },
                        ],
                    },
                },
            };
        }

        // The user is signed in, so use the token to create a Graph Clilent and show profile
        console.log(tokenResponse.token);

        // const graphClient = new SimpleGraphClient(tokenResponse.token);

        //==============
        //     axios.post('https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items/{item-id}', {
        //     "requests": [
        //         {
        //             "entityTypes": [
        //                 "listItem"
        //             ],
        //             "query": {
        //                 "queryString": "Kent"
        //             }
        //         }
        //     ]
        // }, {
        //     headers: {
        //         'Authorization': 'Bearer '+ tokenResponse.token,
        //         'Content-Type': 'application/json'
        //     }
        // })
        //     .then(function (response) {
        //         console.log(response);
        //     })
        //     .catch(function (error) {
        //         console.log(error);
        //     });

        const filterQuery = searchQuery + " path:\"https://" + process.env.SharePointDomain + "/sites/" + process.env.SharePointSiteName + "/Lists/" + process.env.SharePointListName + "\"";

        const response = await axios.post('https://graph.microsoft.com/v1.0/search/query', {
            "requests": [
                {
                    "entityTypes": [
                        "listItem"
                    ],
                    "query": {
                        "queryString": filterQuery
                    },
                    "fields": [
                        "id",
                        "title",
                        "contentclass",
                        "last_name",
                        "field_2",
                        "address"
                    ]
                }
            ]
        }, {
            headers: {
                'Authorization': 'Bearer ' + tokenResponse.token,
                'Content-Type': 'application/json'
            }
        });

        if (response != null && response !== "undefined" && response.data != null && response.data !== "undefined") {
            if (response.data.value != null) {
                var hits = response.data.value[0].hitsContainers[0].hits;

                if (hits != null && hits != "undefined") {
                    var finalDetails = hits.flatMap(arr => arr.resource.fields);

                    finalDetails.forEach(obj => {

                        const thumbnailCard = CardFactory.thumbnailCard(
                            obj.title, obj.title,
                            CardFactory.images([
                                "https://pbs.twimg.com/profile_images/3647943215/d7f12830b3c17a5a9e4afcc370e3a37e_400x400.jpeg"
                            ]));

                        // const heroCard = CardFactory.heroCard(obj.title);
                        const preview = CardFactory.thumbnailCard(obj.title, obj.title,
                            CardFactory.images([
                                "https://pbs.twimg.com/profile_images/3647943215/d7f12830b3c17a5a9e4afcc370e3a37e_400x400.jpeg"
                            ])
                        );

                        // preview.content.tap = { type: 'invoke', value: { description: obj.title } };
                        const attachment = { ...thumbnailCard, preview };
                        attachments.push(attachment);
                    });

                    return {
                        composeExtension: {
                            type: 'result',
                            attachmentLayout: 'list',
                            attachments: attachments
                        }
                    };
                }
                else {
                    return null;
                }
            }
        }

        return {
            composeExtension: {
                type: 'result',
                attachmentLayout: 'list',
                attachments: [CardFactory.thumbnailCard("No Data Found.")]
            }
        };
    }

    async onInvokeActivity(context) {
        console.log('onInvoke, ' + context.activity.name);
        const valueObj = context.activity.value;

        if (valueObj.authentication) {
            const authObj = valueObj.authentication;
            if (authObj.token) {
                // If the token is NOT exchangeable, then do NOT deduplicate requests.
                if (await this.tokenIsExchangeable(context)) {
                    return await super.onInvokeActivity(context);
                }
                else {
                    const response =
                    {
                        status: 412
                    };

                    return response;
                }
            }
        }

        return await super.onInvokeActivity(context);
    }

    async tokenIsExchangeable(context) {
        let tokenExchangeResponse = null;
        try {
            const userId = context.activity.from.id;
            const valueObj = context.activity.value;
            const tokenExchangeRequest = valueObj.authentication;
            console.log("tokenExchangeRequest.token: " + tokenExchangeRequest.token);

            const userTokenClient = context.turnState.get(context.adapter.UserTokenClientKey);

            tokenExchangeResponse = await userTokenClient.exchangeToken(
                userId,
                this.connectionName,
                context.activity.channelId,
                { token: tokenExchangeRequest.token });

            console.log('tokenExchangeResponse: ' + JSON.stringify(tokenExchangeResponse));
        }
        catch (err) {
            console.log('tokenExchange error: ' + err);
            // Ignore Exceptions
            // If token exchange failed for any reason, tokenExchangeResponse above stays null , and hence we send back a failure invoke response to the caller.
        }
        if (!tokenExchangeResponse || !tokenExchangeResponse.token) {
            return false;
        }

        console.log('Exchanged token: ' + JSON.stringify(tokenExchangeResponse));
        return true;
    }
}

module.exports.TeamsMessagingExtensionsSearchAuthConfigBot = TeamsMessagingExtensionsSearchAuthConfigBot;