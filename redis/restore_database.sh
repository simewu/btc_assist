redis-cli config get dir
sudo service redis-server stop
sudo cp dump.rdb /var/lib/redis
sudo chown redis: /var/lib/redis/dump.rdb
sudo service redis-server start
echo "Database was restored."