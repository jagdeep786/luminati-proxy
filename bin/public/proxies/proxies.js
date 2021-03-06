// LICENSE_CODE ZON ISC
'use strict'; /*jslint browser:true*/
define(['angular', 'socket.io-client', 'lodash', 'moment',
    'es6_shim', '../util', 'angular-material', 'md-data-table',
    'angular-chart', '../health_markers/health_markers', 'css!./proxies'],
    function(angular, io, _, moment){

var proxies = angular.module('lum-proxies', ['ngMaterial', 'md.data.table',
    'chart.js', 'lum-health-markers', 'lum-util', 'lum-consts']);

proxies.value('lumProxyWindowConfig', {
    refresh: 100,
    size: 25*1000,
    delay: 2*1000,
    history: 50*1000
});

proxies.service('lumProxyGraphOptions', ProxyGraphOptions);
ProxyGraphOptions.$inject = ['$interval', 'lumProxyWindowConfig'];
function ProxyGraphOptions($interval, win_config){
    this.$interval = $interval;
    this._config = win_config;
    this._time_options = {};
    this._usage_counter = 0;
    this._options = {
        animation: {duration: 0},
        elements: {
            line: {borderWidth: 0.5},
            point: {radius: 0},
        },
        fill: true,
        legend: {display: false},
        scales: {
            xAxes: [{
                display: false,
                type: 'time',
                time: this._time_options,
            }],
            yAxes: [{
                position: 'right',
                ticks: {
                    min: 0,
                    stepSize: 1,
                    suggestedMax: 1,
                    beginAtZero: true,
                    callback: function(value){
                        return Math.floor(value)==value ? value : ''; },
                }
            }],
            gridLines: {display: false},
        },
        tooltips: {enabled: false},
    };
    return this;
}

ProxyGraphOptions.prototype.calculate_window = function(){
    var end = Date.now() - this._config.delay;
    var start = end - this._config.size;
    this._time_options.min = start;
    this._time_options.max = end;
};

ProxyGraphOptions.prototype.get_options = function(){
    ++this._usage_counter;
    if (!this._interval)
    {
        this.calculate_window();
        // XXX lee - causes browser to show as if reloading
        this._interval = this.$interval(this.calculate_window.bind(this),
            this._config.refresh);
    }
    return this._options;
};

ProxyGraphOptions.prototype.release_options = function(){
    if (!--this._usage_counter)
    {
        this.$interval.cancel(this._interval);
        this._interval = null;
    }
};

proxies.factory('lumProxies', proxiesService);
proxiesService.$inject = ['$q', '$interval', 'lumProxyWindowConfig',
    'get_json'];
function proxiesService($q, $interval, win_config, get_json){
    var service = {
        subscribe: subscribe,
        proxies: null,
        update: update_proxies
    };
    var listeners = [];
    service.update();
    io().on('stats', stats_event);
    return service;
    function subscribe(func){
        listeners.push(func);
        if (service.proxies)
            func(service.proxies);
    }
    function update_proxies(){
        return get_json('/api/proxies').then(function(proxies){
            proxies.forEach(function(proxy){
                proxy.stats = {total: {active_requests: [],
                        status: {codes: ['2xx'], values: [[]]}}, ticks: []};
            });
            service.proxies = proxies;
            listeners.forEach(function(cb){ cb(proxies); });
            return proxies;
        });
    }
    function stats_event(stats_chunk){
        if (!service.proxies)
            return;
        var now = moment().format('hh:mm:ss');
        for (var port in stats_chunk)
        {
            var chunk = stats_chunk[port];
            var proxy = _.find(service.proxies, {port: +port});
            var data = _.values(chunk);
            var stats = proxy.stats;
            var status = stats.total.status;
            stats.ticks.push(now);
            var active_requests = _.sumBy(data, 'active_requests');
            stats.total.active_requests.push(active_requests);
            var codes = data.reduce(function(r, host){
                return r.concat(_.keys(host.status_code)); }, []);
            codes = _.uniq(codes);
            codes.forEach(function(code){
                var i = status.codes.indexOf(code);
                if (i==-1)
                {
                    status.codes.push(code);
                    i = status.codes.length-1;
                    status.values.push(new Array(stats.ticks.length-1));
                    _.fill(status.values[i], 0);
                }
                var total = _.sumBy(data, 'status_code.'+code);
                status.values[i].push(total);
            });
            var len = stats.ticks.length;
            status.values.forEach(function(values){
                if (values.length<len)
                    values.push(0);
            });
        }
    }
}

proxies.value('lumOptColumns', [
    {key: 'super_proxy', title: 'Host'},
    {key: 'zone', title: 'Zone'},
    {key: 'country', title: 'Country'},
    {key: 'state', title: 'State'},
    {key: 'city', title: 'City'},
    {key: 'asn', title: 'ASN'},
    {key: 'cid', title: 'Client ID'},
    {key: 'ip', title: 'IP'},
    {key: 'session_timeout', title: 'Session timeout'},
    {key: 'dns', title: 'DNS'},
    {key: 'resolve', title: 'Resolve'},
    {key: 'pool_size', title: 'Pool size'},
    {key: 'proxy_count', title: 'Minimum proxies count'},
    {key: 'sticky_ip', title: 'Sticky IP'},
    {key: 'max_requests', title: 'Max requests'},
    {key: 'log', title: 'Log Level'},
]);

proxies.controller('ProxiesTable', proxy_table);
proxy_table.$inject = ['lumProxies', 'lumOptColumns',
    'lumProxyGraphOptions', '$mdDialog', '$http', 'lumConsts', 'get_json'];
function proxy_table(lum_proxies, opt_columns, graph_options, $mdDialog, $http,
    consts, get_json)
{
    this.$mdDialog = $mdDialog;
    this.$http = $http;
    this.get_json = get_json;
    this.lum_proxies = lum_proxies;
    var $vm = this;
    $vm.consts = consts.proxy;
    $vm.resolved = false;
    $vm.proxies = [];
    $vm.columns = [];
    $vm.graph_options = graph_options.get_options();
    $vm._graph_options_provider = graph_options;
    lum_proxies.subscribe(function(proxies){
        $vm.resolved = true;
        $vm.proxies = proxies;
        var always = ['zone', 'session_timeout', 'pool_size'];
        $vm.columns = opt_columns.filter(function(col){
            var key = col.key;
            return always.indexOf(key)>-1 || _.some(proxies, key);
        });
    });
}

proxy_table.prototype.$onDestroy = function(){
    this._graph_options_provider.release_options(); };

proxy_table.prototype.edit_proxy = function(proxy_old){
    var _proxy = proxy_old ? _.cloneDeep(proxy_old) : null;
    var _this = this;
    this.$mdDialog.show({
        controller: edit_controller,
        templateUrl: '/create/dialog.html',
        parent: angular.element(document.body),
        clickOutsideToClose: true,
        locals: {proxy: _proxy, consts: this.consts},
        fullscreen: true
    }).then(function(proxy){
        if (!proxy)
          return;
        proxy.persist = true;
        var data = {proxy: proxy};
        var promise;
        if (_proxy)
            promise = _this.$http.put('/api/proxies/'+proxy_old.port, data);
        else
            promise = _this.$http.post('/api/proxies', data);
        promise.then(function(){ _this.lum_proxies.update(); });
    });
};

proxy_table.prototype.show_stats = function(proxy){
    this.$mdDialog.show({
        controller: stats_controller,
        templateUrl: '/proxies/dialog_stats.html',
        parent: angular.element(document.body),
        clickOutsideToClose: true,
        locals: {proxy: proxy},
        fullscreen: true
    });
};

proxy_table.prototype.show_history = function(proxy){
    var locals = {};
    var uri = 'history/'+proxy.port;
    var socket = io();
    this.get_json('/api/history/'+proxy.port).then(function(history){
        locals.history = history;
        socket.on(uri, locals.history.unshift.bind(locals.history));
    });
    this.$mdDialog.show({
        controller: history_controller,
        templateUrl: '/proxies/dialog_history.html',
        parent: angular.element(document.body),
        clickOutsideToClose: true,
        locals: locals,
        fullscreen: true
    }).then(function(){ socket.removeAllListeners(uri); });
};

proxy_table.prototype.delete_proxy = function(proxy){
    var _this = this;
    var confirm = this.$mdDialog.confirm({ok: 'ok', cancel: 'cancel',
        title: 'Are you sure you want to delete proxy?'});
    this.$mdDialog.show(confirm).then(function(){
        return _this.$http.delete('/api/proxies/'+proxy.port);
    }).then(function(){ _this.lum_proxies.update(); });
};

proxies.directive('proxiesTable', function(){
    return {
        restrict: 'E',
        scope: {},
        templateUrl: '/proxies/proxies_table.html',
        controller: 'ProxiesTable',
        controllerAs: '$vm',
    };
});

function edit_controller($scope, $mdDialog, locals){
    $scope.form = _.get(locals, 'proxy', {});
    $scope.consts = locals.consts;
    $scope.hide = $mdDialog.hide.bind($mdDialog);
    $scope.cancel = $mdDialog.cancel.bind($mdDialog);
    $scope.validate = function(data){
        data = data||{};
        $mdDialog.hide(data);
    };
}

function stats_controller($scope, $mdDialog, locals){
    var stats = locals.proxy.stats;
    var total = stats.total;
    $scope.requests = [total.active_requests];
    $scope.requests_series = ['Active requests'];
    $scope.codes = total.status.values;
    $scope.codes_series = total.status.codes;
    $scope.labels = stats.ticks;
    $scope.hide = $mdDialog.hide.bind($mdDialog);
    $scope.options = {
        animation: {duration: 0},
        elements: {line: {borderWidth: 0.5}, point: {radius: 0}},
        scales: {
            yAxes: [{
                position: 'right',
                gridLines: {display: false},
                ticks: {beginAtZero: true, suggestedMax: 6},
            }],
        },
    };
    $scope.codes_options = _.merge({elements: {line: {fill: false}},
        legend: {display: true, labels: {boxWidth: 6}},
        grindLines: {display: false}}, $scope.options);
}

function history_controller($scope, $mdDialog, locals){
    $scope.data = locals;
    $scope.hide = $mdDialog.hide.bind($mdDialog);
}

});
