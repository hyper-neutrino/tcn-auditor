import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ButtonStyle,
    Client,
    Colors,
    ComponentType,
    IntentsBitField,
    InteractionType,
    SnowflakeUtil,
} from "discord.js";
import fs from "fs";
import { MongoClient } from "mongodb";
import fetch from "node-fetch";

process.on("uncaughtException", (error) => console.error(error));

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

const PYRO = "<:pyro:1021232648351387668>";
const HYDRO = "<:hydro:1021232713149190264>";
const ANEMO = "<:anemo:1021232755608133712>";
const ELECTRO = "<:electro:1021232812835213362>";
const DENDRO = "<:dendro:1021232875665883196>";
const CRYO = "<:cryo:1021232910268903434>";
const GEO = "<:geo:1021232946289578004>";
const OTHER = "<:other:1021233139856719932>";

const SWORD = "<:sword:1021232974848589864>";
const POLEARM = "<:polearm:1021233017055871006>";
const CLAYMORE = "<:claymore:1021233053097525348>";
const BOW = "<:bow:1021233074618515486>";
const CATALYST = "<:catalyst:1021233107287937074>";
const UNKNOWN = ":question:";

const characters = {
    albedo: [GEO, SWORD],
    aloy: [CRYO, BOW],
    amber: [PYRO, BOW],
    itto: [GEO, CLAYMORE],
    barbara: [HYDRO, CATALYST],
    beidou: [ELECTRO, CLAYMORE],
    bennett: [PYRO, SWORD],
    chongyun: [CRYO, CLAYMORE],
    collei: [DENDRO, BOW],
    diluc: [PYRO, CLAYMORE],
    diona: [CRYO, BOW],
    dori: [ELECTRO, CLAYMORE],
    eula: [CRYO, CLAYMORE],
    fischl: [ELECTRO, BOW],
    ganyu: [CRYO, BOW],
    gorou: [GEO, BOW],
    hutao: [PYRO, POLEARM],
    jean: [ANEMO, SWORD],
    kazuha: [ANEMO, SWORD],
    kaeya: [CRYO, SWORD],
    ayaka: [CRYO, SWORD],
    ayato: [HYDRO, SWORD],
    keqing: [ELECTRO, SWORD],
    klee: [PYRO, CATALYST],
    sara: [ELECTRO, BOW],
    shinobu: [ELECTRO, SWORD],
    lisa: [ELECTRO, CATALYST],
    mona: [HYDRO, CATALYST],
    ningguang: [GEO, CATALYST],
    noelle: [GEO, CLAYMORE],
    qiqi: [CRYO, SWORD],
    raiden: [ELECTRO, POLEARM],
    razor: [ELECTRO, CLAYMORE],
    rosaria: [CRYO, POLEARM],
    kokomi: [HYDRO, CATALYST],
    sayu: [ANEMO, CLAYMORE],
    shenhe: [CRYO, POLEARM],
    heizou: [ANEMO, CATALYST],
    sucrose: [ANEMO, CATALYST],
    tartaglia: [HYDRO, BOW],
    thoma: [PYRO, POLEARM],
    tighnari: [DENDRO, BOW],
    traveler: [OTHER, SWORD],
    venti: [ANEMO, BOW],
    xiangling: [PYRO, POLEARM],
    xiao: [ANEMO, POLEARM],
    xingqiu: [HYDRO, SWORD],
    xinyan: [PYRO, CLAYMORE],
    yae: [ELECTRO, CATALYST],
    yanfei: [PYRO, CATALYST],
    yelan: [HYDRO, BOW],
    yoimiya: [PYRO, BOW],
    yunjin: [GEO, POLEARM],
    zhongli: [GEO, POLEARM],
    dainsleif: [OTHER, UNKNOWN],
};

const none = ":white_check_mark: None";
const _bar = "https://i.imgur.com/035xCzE.png";
const bar = { image: { url: _bar } };
const space = "<:space:1021233715751424060>";

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

    const wrong_invites = [];

    for (const guild of guilds) {
        if (!guild.invite) {
            wrong_invites.push(
                `The invite for ${guild.name} (${guild.character}: \`${guild.id}\`) is missing.`
            );
        } else {
            let invite;

            try {
                invite = await client.fetchInvite(guild.invite);
            } catch {
                wrong_invites.push(
                    `The invite for ${guild.name} (${guild.character}: \`${guild.id}\`) is invalid (\`${guild.invite}\`).`
                );

                continue;
            }

            if (invite.guild.id != guild.id) {
                wrong_invites.push(
                    `The invite for ${guild.name} (${guild.character}: \`${guild.id}\`) points to the wrong server (\`${guild.invite}\` => \`${invite.id}\`).`
                );
            }
        }
    }

    let role;

    for (const guild of guilds) {
        for (const key of ["owner", "advisor", "voter"]) {
            if (!guild[key]) continue;

            let member;
            try {
                member = await hq.members.fetch(guild[key]);
            } catch {
                continue;
            }

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

    if ((role = a2d_positions.get("observer"))) {
        for (const user of users) {
            if (user.roles.includes("observer")) {
                insert(expected, user.id, role);

                const member = hq.members.cache.get(user.id);

                if (member && !member.roles.cache.has(role)) {
                    insert(desynced, user.id, `missing <@&${role}>`);
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
                }\n- Invalid Invites: ${
                    wrong_invites.length > 0
                        ? `\n${wrong_invites
                              .map((line) => `${space}- ${line}`)
                              .join("\n")}`
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
                                      `${space}- ${member} (${
                                          member.user.tag
                                      } \`${member.id}\`): ${errors.join(", ")}`
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
            ...bar,
        })),
    };
}

async function user_info(user) {
    const member = hq.members.cache.get(user.id);

    try {
        let api_user;

        try {
            api_user = await api(`/users/${user.id}`);
        } catch {}

        const guilds = await api("/guilds");

        let position;
        let representing;

        let exit = false;

        for (const guild of guilds) {
            for (const key of ["owner", "advisor"]) {
                if (guild[key] == user.id) {
                    if (position) {
                        position =
                            ":x: This user's position data contains errors. Use `/audit` to find all issues.";
                        representing = null;
                        exit = true;
                        break;
                    } else {
                        position = `${
                            {
                                owner: "Server Owner",
                                advisor: "Council Advisor",
                            }[key]
                        } of ${guild.name} (${characters[guild.character].join(
                            " "
                        )} ${guild.character}: \`${guild.id}\`)`;

                        representing = guild;
                    }
                }
            }

            if (exit) break;
        }

        return {
            embeds: [
                {
                    title: `User info for ${user.tag}`,
                    fields: [
                        {
                            name: "Created",
                            value: `${timestamp(user.createdAt)} (${timestamp(
                                user.createdAt,
                                "R"
                            )})`,
                        },
                        {
                            name: "Position",
                            value: user.bot
                                ? "This user is a bot."
                                : position ??
                                  "This user does not have a position.",
                        },
                        ...(api_user.roles.includes("observer")
                            ? [
                                  {
                                      name: "Observer",
                                      value: ":tools: This user is an **observer**.",
                                  },
                              ]
                            : []),
                        {
                            name: "TCN Roles",
                            value:
                                api_user?.roles
                                    .map((role) => `\`${role}\``)
                                    .join(", ") || "(none)",
                        },
                    ],
                    thumbnail: {
                        url: user.displayAvatarURL({
                            dynamic: true,
                            size: 4096,
                        }),
                    },
                    image: {
                        url:
                            user.bannerURL({
                                dynamic: true,
                                size: 4096,
                            }) ?? _bar,
                    },
                },
                ...(member
                    ? [
                          {
                              title: `Member info for ${member.displayName}`,
                              fields: [
                                  {
                                      name: "Joined",
                                      value: `${timestamp(
                                          member.joinedAt
                                      )} (${timestamp(member.joinedAt, "R")})`,
                                  },
                                  {
                                      name: "Server Roles",
                                      value:
                                          member.roles.cache
                                              .toJSON()
                                              .sort((a, b) =>
                                                  b.comparePositionTo(a)
                                              )
                                              .map((role) => role.toString())
                                              .join(" ") || "(none)",
                                  },
                              ],
                              thumbnail: {
                                  url: member.avatarURL({
                                      dynamic: true,
                                      size: 4096,
                                  }),
                              },
                              ...bar,
                          },
                      ]
                    : []),
            ].map((embed) => ({ ...embed, color: 0x2d3136 })),
            components:
                representing || api_user.roles.includes("observer")
                    ? [
                          {
                              type: ComponentType.ActionRow,
                              components: [
                                  ...(api_user.roles.includes("observer")
                                      ? [
                                            {
                                                type: ComponentType.Button,
                                                style: ButtonStyle.Secondary,
                                                label: "Observer Info",
                                                customId: "info.observers",
                                            },
                                        ]
                                      : []),
                                  ...(representing
                                      ? [
                                            {
                                                type: ComponentType.Button,
                                                style: ButtonStyle.Secondary,
                                                label: `${representing.name} Server Info`,
                                                customId: `info.server.${representing.id}`,
                                            },
                                        ]
                                      : []),
                              ],
                          },
                      ]
                    : [],
        };
    } catch (error) {
        console.error(error);

        return {
            embeds: [
                {
                    title: "ERROR",
                    description: `An error occurred while attempting to fetch info for ${user}.`,
                    color: Colors.Red,
                },
            ],
        };
    }
}

async function guild_info(id) {
    let guild;

    try {
        guild = await api(`/guilds/${id}`);
    } catch {
        return {
            embeds: [
                {
                    title: "ERROR",
                    description: "That is not a valid server.",
                    color: Colors.Red,
                },
            ],
        };
    }

    try {
        const created = Number(SnowflakeUtil.decode(guild.id).timestamp);

        let owner, advisor;

        try {
            owner = await client.users.fetch(guild.owner);
        } catch {}

        try {
            if (guild.advisor) {
                advisor = await client.users.fetch(guild.advisor);
            }
        } catch {}

        let invite;

        try {
            if (guild.invite) {
                invite = await client.fetchInvite(guild.invite);
            }
        } catch {}

        if (invite) {
            invite = invite.guild.id == guild.id ? invite.code : null;
        }

        return {
            embeds: [
                {
                    title: `Server Info for ${guild.name}`,
                    fields: [
                        {
                            name: "Created",
                            value: `${timestamp(created)} (${timestamp(
                                created,
                                "R"
                            )})`,
                        },
                        {
                            name: "Character",
                            value: `${
                                characters[guild.character]?.join(" ") ??
                                "[missing data]"
                            } ${guild.character ?? "[missing character]"}`,
                        },
                        {
                            name: "Owner",
                            value: owner
                                ? `${owner} (${owner.tag} \`${owner.id}\`)${
                                      guild.voter == owner.id
                                          ? " :ballot_box:"
                                          : ""
                                  }`
                                : ":x: Failed to fetch.",
                        },
                        {
                            name: "Advisor",
                            value: advisor
                                ? `${advisor} (${advisor.tag} \`${
                                      advisor.id
                                  }\`)${
                                      guild.voter == advisor.id
                                          ? " :ballot_box:"
                                          : ""
                                  }`
                                : "(none)",
                        },
                        ...(guild.voter != owner?.id &&
                        guild.voter != advisor?.id
                            ? [
                                  {
                                      name: "Voter",
                                      value: "The voter for this server is missing! Use `/audit` to identify all issues.",
                                  },
                              ]
                            : []),
                        {
                            name: "Invite",
                            value: invite
                                ? `[discord.gg/${invite}](https://discord.com/invite/${invite})`
                                : "The invite for this server is missing, invalid, or incorrect! Use `/audit` to identify all issues.",
                        },
                    ],
                },
            ].map((embed) => ({
                ...embed,
                color: 0x2d3136,
            })),
            components:
                owner || advisor
                    ? [
                          {
                              type: ComponentType.ActionRow,
                              components: [
                                  ...(owner
                                      ? [
                                            {
                                                type: ComponentType.Button,
                                                style: ButtonStyle.Secondary,
                                                label: "Owner Info",
                                                customId: `info.user.${owner.id}`,
                                            },
                                        ]
                                      : []),
                                  ...(advisor
                                      ? [
                                            {
                                                type: ComponentType.Button,
                                                style: ButtonStyle.Secondary,
                                                label: "Advisor Info",
                                                customId: `info.user.${advisor.id}`,
                                            },
                                        ]
                                      : []),
                              ],
                          },
                      ]
                    : [],
        };
    } catch (error) {
        console.error(error);

        return {
            embeds: [
                {
                    title: "ERROR",
                    description: `An error occurred while attempting to display info for ${guild.name}.`,
                    color: Colors.Red,
                },
            ],
        };
    }
}

async function observers_info() {
    try {
        const observers = (await api("/users")).filter((user) =>
            user.roles.includes("observer")
        );

        const users = new Map();

        for (const api_user of observers) {
            try {
                users.set(api_user.id, await client.users.fetch(api_user.id));
            } catch {}
        }

        const positions = new Map();

        for (const guild of await api("/guilds")) {
            for (const key of ["owner", "advisor"]) {
                if (positions.has(guild[key])) {
                    positions.set(
                        guild[key],
                        ":x: This user's position data contains errors. Use `/audit` to find all issues."
                    );
                } else {
                    positions.set(
                        guild[key],
                        `${
                            {
                                owner: "Server Owner",
                                advisor: "Council Advisor",
                            }[key]
                        } of ${guild.name} (${characters[guild.character].join(
                            " "
                        )} ${guild.character}: \`${guild.id}\`)`
                    );
                }
            }
        }

        return {
            embeds: [
                {
                    title: "Observers",
                    description: "",
                    fields: await Promise.all(
                        observers.map((api_user) =>
                            ((user) => ({
                                name: `_ _\n${
                                    user
                                        ? `Info for **${user.tag}**`
                                        : "**Missing User**"
                                }`,
                                value: `${
                                    user
                                        ? `${user} (${user.tag} \`${user.id}\`)`
                                        : `Missing user with ID \`${api_user.id}\``
                                }\n${positions.get(api_user.id)}`,
                            }))(users.get(api_user.id))
                        )
                    ),
                    color: 0x2d3136,
                    ...bar,
                },
            ],
            components: [
                {
                    type: ComponentType.ActionRow,
                    components: [
                        {
                            type: ComponentType.SelectMenu,
                            options: observers
                                .map((api_user) => users.get(api_user.id))
                                .filter((x) => x)
                                .map((user) => ({
                                    label: `Info: ${user.tag}`,
                                    value: user.id,
                                })),
                            customId: "info.user",
                        },
                    ],
                },
            ],
        };
    } catch (error) {
        console.error(error);

        return {
            embeds: [
                {
                    title: "ERROR",
                    description:
                        "An error occurred fetching or displaying the observer info.",
                    color: Colors.Red,
                },
            ],
        };
    }
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
                            choices: [
                                "owner",
                                "advisor",
                                "voter",
                                "observer",
                            ].map((x) => ({
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
        {
            type: ApplicationCommandType.ChatInput,
            name: "info",
            description: "get TCN info for an entity",
            dm_permission: false,
            options: [
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "user",
                    description: "get TCN info for a user",
                    options: [
                        {
                            type: ApplicationCommandOptionType.User,
                            name: "user",
                            description: "the user to fetch",
                            required: true,
                        },
                        ephemeral,
                    ],
                },
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "server",
                    description: "get TCN info for a server",
                    options: [
                        {
                            type: ApplicationCommandOptionType.String,
                            name: "server",
                            description: "the server to fetch",
                            required: true,
                            autocomplete: true,
                        },
                        ephemeral,
                    ],
                },
                {
                    type: ApplicationCommandOptionType.Subcommand,
                    name: "observers",
                    description: "get info on the current observers",
                    options: [ephemeral],
                },
            ],
        },
    ]);

    console.log("HQ Bot is ready!");
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
        } else if (cmd.commandName == "info") {
            const sub = cmd.options.getSubcommand();

            if (sub == "user") {
                const user = cmd.options.getUser("user");
                await user.fetch();

                await cmd.editReply(await user_info(user));
            } else if (sub == "server") {
                await cmd.editReply(
                    await guild_info(cmd.options.getString("server"))
                );
            } else if (sub == "observers") {
                await cmd.editReply(await observers_info());
            }
        }
    } else if (cmd.type == InteractionType.ApplicationCommandAutocomplete) {
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
                            guild.name.toLowerCase().indexOf(query) != -1 ||
                            guild.character.toLowerCase().indexOf(query) != -1
                    )
                    .map((guild) => ({
                        name: `${guild.character}: ${guild.name}`,
                        value: guild.id,
                    }))
                    .slice(0, 25)
            );
        }
    } else if (cmd.type == InteractionType.MessageComponent) {
        const args = cmd.customId.split(/\./);

        if (args[0] == "info") {
            if (args[1] == "user") {
                await cmd.deferUpdate();

                const uid =
                    cmd.componentType == ComponentType.Button
                        ? args[2]
                        : cmd.values[0];

                try {
                    const user = await client.users.fetch(uid);
                    await cmd.editReply(await user_info(user));
                } catch (error) {
                    await cmd.editReply({
                        embeds: [
                            {
                                title: "ERROR",
                                description: `Failed to fetch user with ID \`${uid}\`.`,
                                color: Colors.Red,
                            },
                        ],
                        ephemeral: true,
                    });

                    throw error;
                }
            } else if (args[1] == "server") {
                await cmd.deferUpdate();
                await cmd.editReply(await guild_info(args[2]));
            } else if (args[1] == "observers") {
                await cmd.deferUpdate();
                await cmd.editReply(await observers_info());
            }
        }
    }
});

function timestamp(date, format = "F") {
    date = date?.getTime?.() ?? date;
    return `<t:${Math.floor(date / 1000)}${format ? `:${format}` : ""}>`;
}

client.login(config.discord_token);
