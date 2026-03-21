module.exports = {
    apps: [
        {
            name: "pac-royale-frontend",
            script: "npx",
            args: "vite preview",
            cwd: "/home/lynx/rustpacman/Rust-Pacman/pac-royale/frontend",
            env: {
                NODE_ENV: "production",
            },
            restart_delay: 3000,
            max_restarts: 10,
        },
    ],
};
