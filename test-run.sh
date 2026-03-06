cd shieldyield-workflow
PK=$(grep PRIVATE_KEY= ../../shieldyield-contracts/.env | cut -d= -f2)
CRE_ETH_PRIVATE_KEY=$PK bun simulation/sim-daemon.ts
