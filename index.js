import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    Client,
    Colors,
    IntentsBitField,
    InteractionType,
} from "discord.js";
import fs from "fs";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";

process.on("uncaughtException", (error) => {
    console.error(error);
});

const config = JSON.parse(fs.readFileSync("config.json"));

const client = new Client({
    intents: [IntentsBitField.Flags.GuildMembers, IntentsBitField.Flags.Guilds],
});

const mongo_client = new MongoClient(config.mongo_uri);
const _db = mongo_client.db();
const db = _db.collection.bind(_db);
await mongo_client.connect();

const ephemeral = {
    type: ApplicationCommandOptionType.Boolean,
    name: "ephemeral",
    description: "whether or not the result should be hidden (default: false)",
    required: false,
};

const none = ":white_check_mark: None";

let guild_cache, hq;

async function api(route) {
    const response = await fetch(
        `https://api.teyvatcollective.network${route}`,
        {
            headers: {
                Authorization: `Bearer ${config.api_token}`,
            },
        }
    );

    if (!response.ok) {
        throw `API did not return OK:\n- route: ${route}\n- ${response.status}: ${response.statusText}`;
    }

    return await response.json();
}

async function audit() {
    const users = await api("/users");
    const guilds = await api("/guilds");

    const ownerless = guilds.filter((guild) => !guild.owner);
    const voterless = guilds.filter((guild) => !guild.voter);

    const council_map = new Map();
    for (const guild of guilds) {
        for (const user of [guild.owner, guild.advisor]) {
            if (!user) continue;
            if (!council_map.has(user)) council_map.set(user, []);
            council_map.get(user).push(guild);
        }
    }

    const duplicate_representatives = [...council_map.entries()].filter(
        ([_, guilds]) => guilds.length > 1
    );

    const wrong_voter = guilds.filter(
        (guild) =>
            guild.voter && ![guild.owner, guild.advisor].includes(guild.voter)
    );

    const voter_map = new Map();
    for (const guild of guilds) {
        if (!voter_map.has(guild.voter)) voter_map.set(guild.voter, []);
        voter_map.get(guild.voter).push(guild);
    }

    const duplicate_voters = [...voter_map.entries()].filter(
        ([_, guilds]) => guilds.length > 1
    );

    const authorized = users
        .filter((user) =>
            ["owner", "advisor"].some((x) => user.roles.includes(x))
        )
        .map((user) => user?.id)
        .filter((x) => x);

    const unauthorized = (await hq.members.fetch())
        .toJSON()
        .filter(
            (member) => !member.user.bot && !authorized.includes(member.id)
        );

    const missing = await Promise.all(
        authorized
            .filter((user) => !hq.members.cache.has(user))
            .map((user) => client.users.fetch(user))
    );

    const a2d_servers = new Map();
    const a2d_positions = new Map();

    const bound = new Set();

    for (const entry of await db("guild_bind").find({}).toArray()) {
        bound.add(entry.role);
        a2d_servers.set(entry.guild, entry.role);
    }

    for (const entry of await db("position_bind").find({}).toArray()) {
        bound.add(entry.role);
        a2d_positions.set(entry.position, entry.role);
    }

    const desynced = new Map();
    const expected = new Map();

    const insert = (table, key, item) => {
        if (!table.has(key)) table.set(key, new Set());
        table.get(key).add(item);
    };

    for (const guild of guilds) {
        for (const key of ["owner", "advisor", "voter"]) {
            if (!guild[key]) continue;

            let member;
            try {
                member = await hq.members.fetch(guild[key]);
            } catch {
                continue;
            }

            let role;

            if ((role = a2d_servers.get(guild.id))) {
                insert(expected, member.id, role);

                if (!member.roles.cache.has(role)) {
                    insert(desynced, member.id, `missing <@&${role}>`);
                }
            }

            if ((role = a2d_positions.get(key))) {
                insert(expected, member.id, role);

                if (!member.roles.cache.has(role)) {
                    insert(desynced, member.id, `missing <@&${role}>`);
                }
            }
        }
    }

    for (const member of hq.members.cache.toJSON()) {
        for (const role of member.roles.cache.toJSON()) {
            if (bound.has(role.id) && !expected.get(member.id)?.has(role.id)) {
                insert(desynced, member.id, `unexpected ${role}`);
            }
        }
    }

    return {
        embeds: [
            {
                title: "Audit: Stats",
                description: `Users: ${users.length}\nGuilds: ${
                    guilds.length
                }\nGuilds with no advisor: ${
                    guilds.filter((guild) => !guild.advisor).length
                }`,
            },
            {
                title: "Audit: API Data",
                description: `Checking for...\n- Guilds with no owner: ${
                    ownerless.length > 0
                        ? `:x: ${ownerless
                              .map((guild) => guild.name)
                              .join(", ")}`
                        : none
                }\n- Guilds with no voter: ${
                    voterless.length > 0
                        ? `:x: ${voterless
                              .map((guild) => guild.name)
                              .join(", ")}`
                        : none
                }\n- Duplicate Representatives: ${
                    duplicate_representatives.length > 0
                        ? `:x: ${duplicate_representatives
                              .map(
                                  ([user, guilds]) =>
                                      `<@${user}>: ${guilds
                                          .map(
                                              (guild) =>
                                                  `${guild.name} ${
                                                      guild.owner == user
                                                          ? guild.advisor ==
                                                            user
                                                              ? "Owner + Advisor"
                                                              : "Owner"
                                                          : "Advisor"
                                                  }`
                                          )
                                          .join(", ")}`
                              )
                              .join(", ")}`
                        : none
                }\n- Voters who do not represent their server: ${
                    wrong_voter.length > 0
                        ? `:x: ${wrong_voter
                              .map((guild) => guild.name)
                              .join(", ")}`
                        : none
                }\n- Duplicate Voters: ${
                    duplicate_voters.length > 0
                        ? `:x: ${duplicate_voters
                              .map(
                                  ([user, guilds]) =>
                                      `<@${user}>: ${guilds
                                          .map((guild) => guild.name)
                                          .join(", ")}`
                              )
                              .join(", ")}`
                        : none
                }`,
            },
            {
                title: "Audit: HQ Sync",
                description: `Checking for...\n- Unauthorized members: ${
                    unauthorized.length > 0
                        ? `:x: ${unauthorized.map(
                              (member) =>
                                  `${member} (${member.user.tag} \`${member.id}\`)`
                          )}`
                        : none
                }\n- Missing council members: ${
                    missing.length > 0
                        ? `:x: ${missing.map(
                              (user) => `${user} (${user.tag} \`${user.id}\`)`
                          )}`
                        : none
                }\n- Desynced roles: ${
                    desynced.size > 0
                        ? `\n${[...desynced.entries()]
                              .map(([member, errors]) => [
                                  hq.members.cache.get(member),
                                  [...errors].sort(),
                              ])
                              .map(
                                  ([member, errors]) =>
                                      `    - ${member} (${member.user.tag} \`${
                                          member.id
                                      }\`): ${errors.join(", ")}`
                              )
                              .join("\n")}`
                        : none
                }`,
            },
        ].map((embed) => ({
            ...((embed.description =
                embed.description.length > 4096
                    ? embed.description.substring(0, 4093) + "..."
                    : embed.description),
            embed),
            color: 0x2d3136,
            image: { url: "https://i.imgur.com/035xCzE.png" },
        })),
    };
}

client.on("ready", async () => {
    hq = await client.guilds.fetch(config.hq);

    await client.application.commands.set([
        {
            type: ApplicationCommandType.ChatInput,
            name: "audit",
            description: "manually run the API and HQ audit cycle",
            dm_permission: false,
            options: [ephemeral],
        },
        {
            type: ApplicationCommandType.ChatInput,
            name: "bind",
            description: "bind an API role to an HQ role",
            dm_permission: false,
            default_member_permissions: "0",
            options: [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "server",
                    description: "bind a server role",
                    options: [
                        {
                            type: ApplicationCommandOptionType.String,
                            name: "server",
                            description: "the name of the server to bind",
                            required: true,
                            autocomplete: true,
                        },
                        {
                            type: ApplicationCommandOptionType.Role,
                            name: "role",
                            description:
                                "the role to bind (leave blank to unbind)",
                            required: false,
                        },
                        ephemeral,
                    ],
                },
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "position",
                    description: "bind a position role",
                    options: [
                        {
                            type: ApplicationCommandOptionType.String,
                            name: "position",
                            description: "the position to bind",
                            required: true,
                            choices: ["owner", "advisor", "voter"].map((x) => ({
                                name: x,
                                value: x,
                            })),
                        },
                        {
                            type: ApplicationCommandOptionType.Role,
                            name: "role",
                            description:
                                "the role to bind (leave blank to unbind)",
                            required: false,
                        },
                        ephemeral,
                    ],
                },
            ],
        },
    ]);

    console.log("TCN Auditor is ready!");
});

client.on("interactionCreate", async (cmd) => {
    if (cmd.type == InteractionType.ApplicationCommand) {
        await cmd.deferReply({
            ephemeral: !!cmd.options.getBoolean("ephemeral"),
        });

        if (cmd.commandName == "audit") {
            try {
                await cmd.editReply(await audit());
            } catch (error) {
                await cmd.editReply({
                    embeds: [
                        {
                            title: "ERROR",
                            description:
                                "An error occurred while attempting to run the TCN auditor.",
                            color: Colors.Red,
                        },
                    ],
                });

                throw error;
            }
        } else if (cmd.commandName == "bind") {
            const sub = cmd.options.getSubcommand();

            let db_name, selector, message;
            const role = cmd.options.getRole("role");

            if (role) {
                let e;

                if ((e = await db("guild_bind").findOne({ role: role.id }))) {
                    let guild;

                    try {
                        guild = await api(`/guilds/${e.guild}`);

                        return await cmd.editReply({
                            embeds: [
                                {
                                    title: "ERROR",
                                    description: `That role is already bound to ${guild.name} (${guild.character}: \`${guild.id}\`)`,
                                    color: Colors.Red,
                                },
                            ],
                        });
                    } catch {
                        await db("guild_bind").findOneAndDelete({
                            role: role.id,
                        });
                    }
                }

                if (
                    (e = await db("position_bind").findOne({ role: role.id }))
                ) {
                    return await cmd.editReply({
                        embeds: [
                            {
                                title: "ERROR",
                                description: `That role is currently bound as the ${e.position} role.`,
                                color: Colors.Red,
                            },
                        ],
                    });
                }
            }

            if (sub == "server") {
                let guild;

                try {
                    guild = await api(
                        `/guilds/${cmd.options.getString("server")}`
                    );
                } catch {
                    return await cmd.editReply({
                        embeds: [
                            {
                                title: "ERROR",
                                description: "That is not a valid server.",
                                color: Colors.Red,
                            },
                        ],
                    });
                }

                db_name = "guild_bind";
                selector = { guild: guild.id };

                message = `server role for ${guild.name} (${guild.character}: \`${guild.id}\`)`;
            } else if (sub == "position") {
                const position = cmd.options.getString("position");

                db_name = "position_bind";
                selector = { position };

                message = `${position} role`;
            }

            if (role) {
                await db(db_name).findOneAndUpdate(
                    selector,
                    { $set: { role: role.id } },
                    { upsert: true }
                );
            } else {
                await db(db_name).findOneAndDelete(selector);
            }

            await cmd.editReply({
                embeds: [
                    {
                        title: "SUCCESS",
                        description: `The ${message} has been ${
                            role ? `set to ${role}` : "unset"
                        }.`,
                        color: Colors.Green,
                    },
                ],
            });
        }
    } else if (cmd.type == InteractionType.ApplicationCommandAutocomplete) {
        if (cmd.commandName == "bind") {
            const sub = cmd.options.getSubcommand();

            if (sub == "server") {
                const focused = cmd.options.getFocused(true);

                if (focused.name == "server") {
                    if (focused.value || !guild_cache) {
                        guild_cache = await api("/guilds");
                    }

                    const query = focused.value.toLowerCase();

                    await cmd.respond(
                        guild_cache
                            .filter(
                                (guild) =>
                                    guild.name.toLowerCase().indexOf(query) !=
                                        -1 ||
                                    guild.character
                                        .toLowerCase()
                                        .indexOf(query) != -1
                            )
                            .map((guild) => ({
                                name: `${guild.character}: ${guild.name}`,
                                value: guild.id,
                            }))
                            .slice(0, 25)
                    );
                }
            }
        }
    }
});

client.login(config.discord_token);
