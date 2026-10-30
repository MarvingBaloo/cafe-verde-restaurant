#!/bin/bash
# Script de démarrage amélioré pour le serveur backend
# Vérifie le port, nettoie les anciens processus et démarre proprement

set -e

echo "🔧 Démarrage du serveur backend Green & Tea..."

# Configuration
PORT=${PORT:-5001}
LOG_FILE="server_start.log"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")

echo "🕐 Timestamp: $TIMESTAMP"
echo "🌐 Port: $PORT"

# Fonction pour nettoyer les anciens processus
cleanup_old_processes() {
    echo "🧹 Nettoyage des anciens processus sur le port $PORT..."
    
    # Trouver les PIDs des processus utilisant le port
    PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
    
    if [ ! -z "$PIDS" ]; then
        echo "⚠️  Processus trouvés sur le port $PORT: $PIDS"
        echo "🛑 Arrêt des processus..."
        for PID in $PIDS; do
            if kill -0 $PID 2>/dev/null; then
                echo "  ⏹️  Arrêt du PID $PID..."
                kill -TERM $PID 2>/dev/null || true
                sleep 1
                # Force kill si nécessaire
                if kill -0 $PID 2>/dev/null 2>&1; then
                    echo "  💥 Force kill du PID $PID..."
                    kill -9 $PID 2>/dev/null || true
                fi
            fi
        done
        sleep 2
    else
        echo "✅ Aucun ancien processus trouvé sur le port $PORT"
    fi
    
    # Vérification finale
    REMAINING_PIDS=$(lsof -ti:$PORT 2>/dev/null || true)
    if [ ! -z "$REMAINING_PIDS" ]; then
        echo "❌ Impossible de libérer le port $PORT. PIDs restants: $REMAINING_PIDS"
        return 1
    fi
    
    echo "✅ Port $PORT complètement libéré"
    return 0
}

# Fonction pour vérifier le port
check_port() {
    echo "🔍 Vérification du port $PORT..."
    if lsof -ti:$PORT >/dev/null 2>&1; then
        echo "❌ Port $PORT déjà occupé"
        return 1
    else
        echo "✅ Port $PORT disponible"
        return 0
    fi
}

# Fonction pour vérifier les dépendances
check_dependencies() {
    echo "📦 Vérification des dépendances..."
    
    # Vérifier Node.js
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js n'est pas installé"
        return 1
    fi
    NODE_VERSION=$(node --version)
    echo "  ✅ Node.js: $NODE_VERSION"
    
    # Vérifier npm
    if ! command -v npm &> /dev/null; then
        echo "❌ npm n'est pas installé"
        return 1
    fi
    NPM_VERSION=$(npm --version)
    echo "  ✅ npm: v$NPM_VERSION"
    
    # Vérifier MongoDB (optionnel, juste un warning)
    if ! command -v mongosh &> /dev/null && ! command -v mongo &> /dev/null; then
        echo "  ⚠️  MongoDB n'est pas installé localement (peut être hébergé ailleurs)"
    else
        echo "  ✅ MongoDB disponible"
    fi
    
    return 0
}

# Fonction pour démarrer le serveur
start_server() {
    echo "🚀 Démarrage du serveur..."
    
    # Vérifier si nodemon est disponible
    if npm list nodemon 2>/dev/null | grep -q nodemon || [ -f "node_modules/.bin/nodemon" ]; then
        echo "  📦 Utilisation de nodemon pour le développement"
        CMD="npx nodemon server.js"
    else
        echo "  ⚙️  Utilisation de node directement"
        CMD="node server.js"
    fi
    
    # Démarrer le serveur en arrière-plan avec logging
    echo "  💻 Commande: $CMD"
    echo "  📝 Logs: $LOG_FILE"
    
    # Redémarrer le serveur avec gestion des logs
    $CMD > "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    
    echo "  🔄 PID du serveur: $SERVER_PID"
    
    # Attendre que le serveur démarre
    echo "  ⏳ Attente du démarrage du serveur..."
    sleep 8
    
    # Vérifier si le serveur est en cours d'exécution
    if kill -0 $SERVER_PID 2>/dev/null; then
        echo "  ✅ Serveur démarré avec succès (PID: $SERVER_PID)"
    else
        echo "  ❌ Le serveur s'est arrêté immédiatement"
        echo "  📋 Dernières lignes du log:"
        tail -20 "$LOG_FILE" 2>/dev/null || echo "    (log file non trouvé)"
        return 1
    fi
    
    # Vérifier si le serveur répond
    echo "  🔌 Test de connexion au serveur..."
    if curl -s -f "http://localhost:$PORT" >/dev/null 2>&1; then
        echo "  🌐 Serveur accessible sur http://localhost:$PORT"
    else
        echo "  ⚠️  Serveur démarré mais ne répond pas encore"
    fi
    
    return 0
}

# Fonction principale
main() {
    echo "=========================================="
    echo "   SERVEUR BACKEND GREEN & TEA"
    echo "=========================================="
    
    # Changer de répertoire si nécessaire
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
    cd "$SCRIPT_DIR"
    
    # Vérifier les dépendances
    if ! check_dependencies; then
        echo "❌ Dépendances manquantes"
        exit 1
    fi
    
    # Nettoyer les anciens processus
    if ! cleanup_old_processes; then
        echo "❌ Impossible de nettoyer les anciens processus"
        echo "💡 Essayez de tuer manuellement les processus:"
        echo "   sudo lsof -ti:$PORT | xargs kill -9"
        exit 1
    fi
    
    # Vérifier le port
    if ! check_port; then
        echo "❌ Port $PORT toujours occupé après nettoyage"
        exit 1
    fi
    
    # Démarrer le serveur
    if start_server; then
        echo "=========================================="
        echo "✅ SERVEUR DÉMARRÉ AVEC SUCCÈS"
        echo ""
        echo "📊 Informations:"
        echo "   Port: $PORT"
        echo "   Logs: $LOG_FILE"
        echo "   PID: $SERVER_PID"
        echo "   URL: http://localhost:$PORT"
        echo ""
        echo "🔧 Commandes utiles:"
        echo "   Voir les logs: tail -f $LOG_FILE"
        echo "   Arrêter: kill $SERVER_PID"
        echo "   Redémarrer: ./start_server.sh"
        echo ""
        echo "📡 Routes principales:"
        echo "   • http://localhost:$PORT/api/ingredients"
        echo "   • http://localhost:$PORT/api/products"
        echo "   • http://localhost:$PORT/api/menus"
        echo "   • http://localhost:$PORT/api/orders"
        echo "=========================================="
    else
        echo "=========================================="
        echo "❌ ÉCHEC DU DÉMARRAGE DU SERVEUR"
        echo ""
        echo "🔍 Dépannage:"
        echo "   1. Vérifiez les logs: cat $LOG_FILE"
        echo "   2. Vérifiez que MongoDB est démarré"
        echo "   3. Vérifiez les variables d'environnement"
        echo "   4. Essayez un autre port: PORT=5002 ./start_server.sh"
        echo "=========================================="
        exit 1
    fi
}

# Exécuter la fonction principale
main "$@"