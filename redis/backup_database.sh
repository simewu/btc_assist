redis-cli config get dir
redis-cli save
sudo cp /var/lib/redis/dump.rdb .
sudo chmod +rw dump.rdb
echo "Database was saved to dump.rdb"