redis-cli config get dir
redis-cli save
sudo cp /var/lib/redis/dump.rdb .
sudo chmod +rwx dump.rdb