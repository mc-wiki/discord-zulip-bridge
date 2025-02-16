git pull
npm ci
npm run build
cp config.prod.json config.json
echo Bridge updated.
./scripts/restart.sh
